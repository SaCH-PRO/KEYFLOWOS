/**
 * CLOUD-CONTROL PROOF SUITE — KF-META-CLOUD-DISPATCH-001
 *
 * Verifies Phase 1 Cloud-Native Multi-Agent Control Plane across all 10
 * mandatory adversarial and negative-control categories:
 *   1. Duplicate task claims
 *   2. Conflicting branches or ownership (plus scope violations)
 *   3. Expired and revoked leases
 *   4. Wrong provider or recipient (plus self-review prohibition)
 *   5. Invalid source commit
 *   6. Unauthorized execution or merge requests (plus Issue #80 trigger block)
 *   7. Stale completion evidence
 *   8. Replay after an uncertain execution result
 *   9. Provider failure and safe cross-provider handoff
 *  10. Missing or invalid task authority
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CANONICAL_REPOSITORY,
  CLOUD_DISPATCH_STATUS,
  CLOUD_HANDOFF_SCHEMA,
  CLOUD_PROVIDERS,
  CLOUD_REASONS,
  CLOUD_ROLES,
  CLOUD_TASK_SCHEMA,
  CLOUD_TASK_STATES,
  FileBackedCloudRegistry,
  buildCloudIdempotencyKey,
  chatgptAuthorityAdapter,
  claudeCloudAdapter,
  defaultCloudProviderRegistry,
  dispatchCloudTask,
  evaluateCloudPreflight,
  evaluateLeaseAcquisition,
  geminiCloudAdapter,
  kimiCloudAdapter,
  markExecutionUncertain,
  matchesScopePattern,
  prepareProviderFailoverHandoff,
  recordTaskCompletion,
  saveCloudYamlFile,
  validateCloudHandoff,
  validateCloudTask,
  verifyChangedFilesInScope,
  verifyTaskOwnership,
  verifyUncertainExecutionClearance,
} from '../lib/cloud-control.mjs';
import { runCloudDispatchCli } from '../cloud-dispatch.mjs';
import { parseYaml } from '../lib/yaml.mjs';

const VERIFIED_MAIN_SHA = 'b1948d2797e1bae3660a3d7173abb75397e05aad';
const SAMPLE_SEMANTIC_HEAD = '3e00eb349dee7a95624faa1f358e5916e2744ecc';
const SAMPLE_PR_HEAD = 'fe533e2ef62633fcee95648e4c4eac828c4d14e0';
const STALE_HEAD = '1111111111111111111111111111111111111111';
const NOW_ISO = '2026-11-07T20:00:00Z';

function makeTask(overrides = {}) {
  const task_id = overrides.task_id ?? 'CT-KF-META-CLOUD-DISPATCH-001-001';
  const packet_id = overrides.packet_id ?? 'KF-META-CLOUD-DISPATCH-001';
  const source_main = overrides.source_main ?? VERIFIED_MAIN_SHA;
  const attempt = overrides.attempt ?? 1;
  const defaultIdempotency =
    typeof source_main === 'string' && /^[0-9a-f]{40}$/.test(source_main)
      ? buildCloudIdempotencyKey({ task_id, packet_id, source_main, attempt })
      : 'cloud_task:invalid';

  return {
    schema: CLOUD_TASK_SCHEMA,
    task_id,
    packet_id,
    provider: CLOUD_PROVIDERS.GEMINI,
    agent_identity: 'gemini-cloud-builder-01',
    role: CLOUD_ROLES.BUILDER,
    repository: CANONICAL_REPOSITORY,
    source_main,
    source_head: null,
    implementation_branch: 'impl/kf-meta-cloud-control-001',
    allowed_scope: [
      'scripts/agent-control/**',
      '.github/workflows/agent-cloud-control.yml',
      'docs/development/CLOUD_AGENT_CONTROL_PLANE.md',
      '.agent-control/**',
    ],
    prohibited_scope: [
      'apps/**',
      'packages/**',
      '.github/workflows/agent-control-autopilot.yml',
    ],
    required_tests: [
      'node --test scripts/agent-control/tests/cloud-control.spec.mjs',
    ],
    required_evidence: [
      'exact_head_ci_runs',
      'negative_controls_manifest',
    ],
    risk_level: 'MEDIUM',
    approval_level: 'DRAFT_EVALUATION_ONLY',
    authority: {
      kind: 'OPERATOR_CLOUD_HANDOFF',
      reference: 'KF-META-CLOUD-DISPATCH-001',
      author: 'SaCH-PRO',
      merge_authority: false,
      production_touched: false,
      triggers_legacy_issue80: false,
    },
    attempt,
    idempotency_key: defaultIdempotency,
    state: CLOUD_TASK_STATES.ISSUED,
    lease: null,
    ...overrides,
  };
}

function makeLeasedTask(overrides = {}) {
  const base = makeTask(overrides);
  const acquired = evaluateLeaseAcquisition({
    task: base,
    claimantProvider: base.provider,
    claimantAgentId: base.agent_identity,
    leaseId: 'LEASE-CT-KF-META-CLOUD-DISPATCH-001-001',
    nowIso: NOW_ISO,
    ttlSeconds: 3600,
  });
  assert.equal(acquired.ok, true);
  return {
    ...acquired.task,
    ...overrides,
    lease: overrides.lease !== undefined ? overrides.lease : acquired.lease,
  };
}

function makeHandoff(overrides = {}) {
  return {
    schema: CLOUD_HANDOFF_SCHEMA,
    task_id: 'CT-KF-META-CLOUD-DISPATCH-001-001',
    packet_id: 'KF-META-CLOUD-DISPATCH-001',
    provider: CLOUD_PROVIDERS.GEMINI,
    agent_identity: 'gemini-cloud-builder-01',
    lease_id: 'LEASE-CT-KF-META-CLOUD-DISPATCH-001-001',
    implementation_branch: 'impl/kf-meta-cloud-control-001',
    source_main: VERIFIED_MAIN_SHA,
    semantic_head: SAMPLE_SEMANTIC_HEAD,
    pr_head: SAMPLE_PR_HEAD,
    evidence_head: SAMPLE_PR_HEAD,
    pr_number: 194,
    changed_files: [
      'scripts/agent-control/lib/cloud-control.mjs',
      'scripts/agent-control/cloud-dispatch.mjs',
      '.github/workflows/agent-cloud-control.yml',
      'docs/development/CLOUD_AGENT_CONTROL_PLANE.md',
      'scripts/agent-control/tests/cloud-control.spec.mjs',
      'scripts/agent-control/negative-controls.yaml',
      '.agent-control/active-packet.yaml',
      '.agent-control/claude-return.yaml',
      '.agent-control/cloud-task.yaml',
      '.agent-control/cloud-handoff.yaml',
    ],
    decisions: [
      'D1: Keep Phase 1 cloud dispatch strictly read-only and draft-only with zero merge or production authority.',
      'D2: Block replay of uncertain executions even after lease expiry until ChatGPT records a reconciliation clearance.',
    ],
    scope_ledger: {
      declared: ['Cloud task contract', 'Lease ownership & collision gate', 'Provider adapters', 'Read-only workflow', 'Continuity handoff'],
      resolved: ['Cloud task contract', 'Lease ownership & collision gate', 'Provider adapters', 'Read-only workflow', 'Continuity handoff'],
      remaining: [],
      deferred: ['Unattended outbound provider API invocation (Phase 2)'],
    },
    proof_obligations: [
      { id: 'PROOF-CLOUD-UNIT', command: 'node --test scripts/agent-control/tests/cloud-control.spec.mjs', status: 'PASS' },
    ],
    next_authorized_action: {
      action: 'AWAIT_INDEPENDENT_ARCHITECTURE_AND_ADVERSARIAL_REVIEW',
      assigned_provider: CLOUD_PROVIDERS.CHATGPT,
      merge_authority: false,
      production_touched: false,
    },
    ...overrides,
  };
}

describe('Phase 1 Cloud-Native Multi-Agent Control Plane (KF-META-CLOUD-DISPATCH-001)', () => {
  it('validates a well-formed cloud engineering task envelope and deterministic idempotency key', () => {
    const task = makeTask();
    const res = validateCloudTask(task, { expectedMainSha: VERIFIED_MAIN_SHA });
    assert.equal(res.ok, true);
    assert.equal(res.reason, CLOUD_REASONS.OK);
  });

  // -------------------------------------------------------------------------
  // Category 1: Duplicate task claims
  // -------------------------------------------------------------------------
  it('NC cloud duplicate task claim: rejects re-claiming an already-recorded idempotency key or active task', () => {
    const task = makeTask();
    const first = evaluateLeaseAcquisition({
      task,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: NOW_ISO,
    });
    assert.equal(first.ok, true);

    const replayByKey = evaluateLeaseAcquisition({
      task,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: NOW_ISO,
      recordedIdempotencyKeys: [task.idempotency_key],
    });
    assert.equal(replayByKey.ok, false);
    assert.equal(replayByKey.reason, CLOUD_REASONS.DUPLICATE_TASK_CLAIM);

    const replayByActiveTask = evaluateLeaseAcquisition({
      task,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: NOW_ISO,
      existingTasks: [first.task],
    });
    assert.equal(replayByActiveTask.ok, false);
    assert.equal(replayByActiveTask.reason, CLOUD_REASONS.DUPLICATE_TASK_CLAIM);
  });

  // -------------------------------------------------------------------------
  // Category 2: Conflicting branches, packet collisions, and scope violations
  // -------------------------------------------------------------------------
  it('NC cloud branch collision: rejects a second task targeting an actively leased implementation_branch', () => {
    const leased = makeLeasedTask();
    const competingBranchTask = makeTask({
      task_id: 'CT-KF-META-CLOUD-DISPATCH-002-001',
      packet_id: 'KF-META-OTHER-PACKET-001',
      provider: CLOUD_PROVIDERS.KIMI,
      agent_identity: 'kimi-cloud-builder-01',
      implementation_branch: leased.implementation_branch,
    });

    const res = evaluateLeaseAcquisition({
      task: competingBranchTask,
      claimantProvider: CLOUD_PROVIDERS.KIMI,
      claimantAgentId: 'kimi-cloud-builder-01',
      nowIso: NOW_ISO,
      existingTasks: [leased],
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, CLOUD_REASONS.BRANCH_COLLISION);
  });

  it('rejects packet collision across distinct branches and enforces allowed/prohibited file scopes', () => {
    const leased = makeLeasedTask();
    const competingPacketTask = makeTask({
      task_id: 'CT-KF-META-CLOUD-DISPATCH-001-002',
      packet_id: leased.packet_id,
      provider: CLOUD_PROVIDERS.KIMI,
      agent_identity: 'kimi-cloud-builder-01',
      implementation_branch: 'impl/kf-meta-cloud-control-competing',
    });

    const packetRes = evaluateLeaseAcquisition({
      task: competingPacketTask,
      claimantProvider: CLOUD_PROVIDERS.KIMI,
      claimantAgentId: 'kimi-cloud-builder-01',
      nowIso: NOW_ISO,
      existingTasks: [leased],
    });
    assert.equal(packetRes.ok, false);
    assert.equal(packetRes.reason, CLOUD_REASONS.PACKET_COLLISION);

    assert.equal(matchesScopePattern('scripts/agent-control/lib/cloud-control.mjs', 'scripts/agent-control/**'), true);
    const scopeFail = verifyChangedFilesInScope(leased, [
      'scripts/agent-control/lib/cloud-control.mjs',
      'apps/web/src/app/page.tsx',
      '.github/workflows/agent-control-autopilot.yml',
    ]);
    assert.equal(scopeFail.ok, false);
    assert.equal(scopeFail.reason, CLOUD_REASONS.SCOPE_VIOLATION);
    assert.equal(scopeFail.violations.length, 2);
  });

  // -------------------------------------------------------------------------
  // Category 3: Expired and revoked leases
  // -------------------------------------------------------------------------
  it('NC cloud expired lease: rejects ownership verification once lease.expires_at has passed', () => {
    const leased = makeLeasedTask();
    const expiredCheck = verifyTaskOwnership({
      task: leased,
      actorProvider: leased.provider,
      actorAgentId: leased.agent_identity,
      leaseId: leased.lease.lease_id,
      nowIso: '2026-11-07T22:00:00Z',
    });
    assert.equal(expiredCheck.ok, false);
    assert.equal(expiredCheck.reason, CLOUD_REASONS.LEASE_EXPIRED);
  });

  it('NC cloud revoked lease: rejects ownership verification when lease is revoked', () => {
    const leased = makeLeasedTask();
    const revokedTask = {
      ...leased,
      state: CLOUD_TASK_STATES.REVOKED,
      lease: {
        ...leased.lease,
        revoked: true,
        revoked_reason: 'operator superseded lease',
      },
    };
    const revokedCheck = verifyTaskOwnership({
      task: revokedTask,
      actorProvider: revokedTask.provider,
      actorAgentId: revokedTask.agent_identity,
      leaseId: revokedTask.lease.lease_id,
      nowIso: '2026-11-07T20:10:00Z',
    });
    assert.equal(revokedCheck.ok, false);
    assert.equal(revokedCheck.reason, CLOUD_REASONS.LEASE_REVOKED);
  });

  // -------------------------------------------------------------------------
  // Category 4: Wrong provider or recipient & self-review prohibition
  // -------------------------------------------------------------------------
  it('NC cloud wrong provider: rejects lease ownership or claim by a different provider or recipient and blocks self-review', () => {
    const leased = makeLeasedTask();
    const wrongProviderOwn = verifyTaskOwnership({
      task: leased,
      actorProvider: CLOUD_PROVIDERS.KIMI,
      actorAgentId: leased.agent_identity,
      leaseId: leased.lease.lease_id,
      nowIso: '2026-11-07T20:10:00Z',
    });
    assert.equal(wrongProviderOwn.ok, false);
    assert.equal(wrongProviderOwn.reason, CLOUD_REASONS.WRONG_PROVIDER);

    const wrongRecipientTask = makeTask({
      provider: CLOUD_PROVIDERS.GEMINI,
      agent_identity: 'kimi-agent-spoof',
    });
    const wrongRecipientRes = validateCloudTask(wrongRecipientTask);
    assert.equal(wrongRecipientRes.ok, false);
    assert.equal(wrongRecipientRes.reason, CLOUD_REASONS.WRONG_RECIPIENT);

    const selfReviewTask = makeTask({
      provider: CLOUD_PROVIDERS.GEMINI,
      agent_identity: 'gemini-reviewer-01',
      role: CLOUD_ROLES.ADVERSARIAL_REVIEWER,
      builder_provider: CLOUD_PROVIDERS.GEMINI,
      builder_agent_identity: 'gemini-cloud-builder-01',
    });
    const selfReviewRes = validateCloudTask(selfReviewTask);
    assert.equal(selfReviewRes.ok, false);
    assert.equal(selfReviewRes.reason, CLOUD_REASONS.SELF_REVIEW_FORBIDDEN);

    const missingProvenanceReviewer = makeTask({
      provider: CLOUD_PROVIDERS.KIMI,
      agent_identity: 'kimi-reviewer-01',
      role: CLOUD_ROLES.ADVERSARIAL_REVIEWER,
    });
    const missingProvenanceRes = validateCloudTask(missingProvenanceReviewer);
    assert.equal(missingProvenanceRes.ok, false);
    assert.equal(missingProvenanceRes.reason, CLOUD_REASONS.TASK_INVALID);
  });

  // -------------------------------------------------------------------------
  // Category 5: Invalid source commit
  // -------------------------------------------------------------------------
  it('NC cloud invalid source commit: rejects malformed source_main or a commit not matching verified main', () => {
    const badShaTask = makeTask({ source_main: 'not-a-40-hex-commit-sha' });
    const badShaRes = validateCloudTask(badShaTask);
    assert.equal(badShaRes.ok, false);
    assert.equal(badShaRes.reason, CLOUD_REASONS.INVALID_SOURCE_COMMIT);

    const driftedMainTask = makeTask();
    const driftedRes = validateCloudTask(driftedMainTask, { expectedMainSha: STALE_HEAD });
    assert.equal(driftedRes.ok, false);
    assert.equal(driftedRes.reason, CLOUD_REASONS.SOURCE_COMMIT_NOT_ON_MAIN);
  });

  // -------------------------------------------------------------------------
  // Category 6: Unauthorized execution, merge, production, or Issue #80 requests
  // -------------------------------------------------------------------------
  it('NC cloud unauthorized merge: rejects task envelopes requesting merge authority, production access, or Issue #80 directives', () => {
    const mergeTask = makeTask({ merge_authority: true });
    const mergeRes = validateCloudTask(mergeTask);
    assert.equal(mergeRes.ok, false);
    assert.equal(mergeRes.reason, CLOUD_REASONS.MERGE_NOT_AUTHORIZED);

    const prodTask = makeTask({ production_touched: true });
    const prodRes = validateCloudTask(prodTask);
    assert.equal(prodRes.ok, false);
    assert.equal(prodRes.reason, CLOUD_REASONS.PRODUCTION_NOT_AUTHORIZED);

    const issue80Task = makeTask({ post_issue80_directive: true });
    const issue80Res = validateCloudTask(issue80Task);
    assert.equal(issue80Res.ok, false);
    assert.equal(issue80Res.reason, CLOUD_REASONS.LEGACY_ISSUE80_TRIGGER_FORBIDDEN);
  });

  // -------------------------------------------------------------------------
  // Category 7: Stale completion evidence
  // -------------------------------------------------------------------------
  it('NC cloud stale completion evidence: rejects handoff where evidence_head != pr_head or source_main is stale', () => {
    const leased = makeLeasedTask();
    const staleHandoff = makeHandoff({
      evidence_head: STALE_HEAD,
    });
    const staleRes = validateCloudHandoff(staleHandoff, { task: leased });
    assert.equal(staleRes.ok, false);
    assert.equal(staleRes.reason, CLOUD_REASONS.STALE_COMPLETION_EVIDENCE);

    const nonAncestorHandoff = makeHandoff({
      semantic_head_is_ancestor: false,
    });
    const nonAncestorRes = validateCloudHandoff(nonAncestorHandoff, { task: leased });
    assert.equal(nonAncestorRes.ok, false);
    assert.equal(nonAncestorRes.reason, CLOUD_REASONS.STALE_COMPLETION_EVIDENCE);

    const prodHandoff = makeHandoff({
      next_authorized_action: {
        action: 'AWAIT_INDEPENDENT_ARCHITECTURE_AND_ADVERSARIAL_REVIEW',
        assigned_provider: CLOUD_PROVIDERS.CHATGPT,
        merge_authority: false,
        production_touched: true,
      },
    });
    const prodHandoffRes = validateCloudHandoff(prodHandoff, { task: leased });
    assert.equal(prodHandoffRes.ok, false);
    assert.equal(prodHandoffRes.reason, CLOUD_REASONS.PRODUCTION_NOT_AUTHORIZED);

    const spoofedProviderHandoff = makeHandoff({
      provider: CLOUD_PROVIDERS.KIMI,
      agent_identity: 'kimi-cloud-builder-01',
    });
    const spoofedProviderRes = validateCloudHandoff(spoofedProviderHandoff, { task: leased });
    assert.equal(spoofedProviderRes.ok, false);
    assert.equal(spoofedProviderRes.reason, CLOUD_REASONS.WRONG_PROVIDER);
  });

  // -------------------------------------------------------------------------
  // Category 8: Replay after an uncertain execution result
  // -------------------------------------------------------------------------
  it('NC cloud uncertain execution replay: blocks replay even after lease expiry until ChatGPT reconciliation clearance is provided', () => {
    const leased = makeLeasedTask();
    const uncertainTask = markExecutionUncertain(leased, {
      reason: 'cloud transport dropped before handoff artifact was recorded',
      nowIso: '2026-11-07T20:30:00Z',
    });
    assert.equal(uncertainTask.state, CLOUD_TASK_STATES.UNCERTAIN_RESULT);
    assert.equal(uncertainTask.lease.execution_uncertain, true);

    // Even 3 hours later (after lease expiry), replay without clearance is blocked.
    const blockedReplay = evaluateLeaseAcquisition({
      task: uncertainTask,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: '2026-11-07T23:30:00Z',
    });
    assert.equal(blockedReplay.ok, false);
    assert.equal(blockedReplay.reason, CLOUD_REASONS.UNCERTAIN_EXECUTION_REPLAY_BLOCKED);

    // Submitting a fresh ISSUED copy while the persisted task in existingTasks is uncertain is also blocked.
    const freshTaskAttempt = makeTask();
    const bypassAttempt = evaluateLeaseAcquisition({
      task: freshTaskAttempt,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: '2026-11-07T23:30:00Z',
      existingTasks: [uncertainTask],
    });
    assert.equal(bypassAttempt.ok, false);
    assert.equal(bypassAttempt.reason, CLOUD_REASONS.UNCERTAIN_EXECUTION_REPLAY_BLOCKED);

    // Forged clearance by non-ChatGPT provider is rejected.
    const forgedClearance = verifyUncertainExecutionClearance(uncertainTask, {
      clearance_id: 'CLR-CT-KF-META-CLOUD-DISPATCH-001-001',
      task_id: uncertainTask.task_id,
      packet_id: uncertainTask.packet_id,
      uncertain_lease_id: uncertainTask.lease.lease_id,
      cleared_attempt: uncertainTask.attempt,
      cleared_by_provider: CLOUD_PROVIDERS.GEMINI,
      author: 'SaCH-PRO',
      observed_branch_head: VERIFIED_MAIN_SHA,
      disposition: 'REPLAY_FROM_SOURCE_MAIN',
    });
    assert.equal(forgedClearance.ok, false);
    assert.equal(forgedClearance.reason, CLOUD_REASONS.RECONCILIATION_CLEARANCE_INVALID);

    // Valid ChatGPT reconciliation clearance bound to observed branch head permits controlled re-acquisition.
    const validClearance = {
      clearance_id: 'CLR-CT-KF-META-CLOUD-DISPATCH-001-001',
      task_id: uncertainTask.task_id,
      packet_id: uncertainTask.packet_id,
      uncertain_lease_id: uncertainTask.lease.lease_id,
      cleared_attempt: uncertainTask.attempt,
      cleared_by_provider: CLOUD_PROVIDERS.CHATGPT,
      author: 'SaCH-PRO',
      observed_branch_head: VERIFIED_MAIN_SHA,
      disposition: 'REPLAY_FROM_SOURCE_MAIN',
    };
    const clearedReplay = evaluateLeaseAcquisition({
      task: uncertainTask,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: '2026-11-07T23:30:00Z',
      reconciliationClearance: validClearance,
    });
    assert.equal(clearedReplay.ok, true);
    assert.equal(clearedReplay.task.lease.execution_uncertain, false);
    assert.equal(clearedReplay.consumed_clearance_id, validClearance.clearance_id);

    // Reusing an already-consumed clearance_id is rejected.
    const replayedClearance = evaluateLeaseAcquisition({
      task: uncertainTask,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: '2026-11-07T23:35:00Z',
      reconciliationClearance: validClearance,
      consumedClearanceIds: [validClearance.clearance_id],
    });
    assert.equal(replayedClearance.ok, false);
    assert.equal(replayedClearance.reason, CLOUD_REASONS.RECONCILIATION_CLEARANCE_INVALID);

    // CONTINUE_FROM_OBSERVED_HEAD binds source_head to observed_branch_head; ABORT_AND_REISSUE denies same-attempt claim.
    const continueClearance = {
      ...validClearance,
      clearance_id: 'CLR-CT-KF-META-CLOUD-DISPATCH-001-002',
      observed_branch_head: SAMPLE_SEMANTIC_HEAD,
      disposition: 'CONTINUE_FROM_OBSERVED_HEAD',
    };
    const continuedReplay = evaluateLeaseAcquisition({
      task: uncertainTask,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: '2026-11-07T23:40:00Z',
      reconciliationClearance: continueClearance,
      observedBranchHead: SAMPLE_SEMANTIC_HEAD,
    });
    assert.equal(continuedReplay.ok, true);
    assert.equal(continuedReplay.task.source_head, SAMPLE_SEMANTIC_HEAD);

    const abortClearance = {
      ...validClearance,
      clearance_id: 'CLR-CT-KF-META-CLOUD-DISPATCH-001-003',
      disposition: 'ABORT_AND_REISSUE',
    };
    const abortedReplay = evaluateLeaseAcquisition({
      task: uncertainTask,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: '2026-11-07T23:45:00Z',
      reconciliationClearance: abortClearance,
    });
    assert.equal(abortedReplay.ok, false);
    assert.equal(abortedReplay.reason, CLOUD_REASONS.RECONCILIATION_CLEARANCE_INVALID);
  });

  // -------------------------------------------------------------------------
  // Category 9: Provider failure and safe cross-provider handoff
  // -------------------------------------------------------------------------
  it('NC cloud provider failover: revokes previous provider lease and safely transfers continuity to a backup provider', () => {
    const leased = makeLeasedTask();
    const handoff = makeHandoff({ pr_number: null });

    // Unsafe self-failover to the identical provider + agent is rejected.
    const unsafeSelfFailover = prepareProviderFailoverHandoff({
      task: leased,
      handoff,
      nextProvider: leased.provider,
      nextAgentIdentity: leased.agent_identity,
      nowIso: '2026-11-07T20:20:00Z',
    });
    assert.equal(unsafeSelfFailover.ok, false);
    assert.equal(unsafeSelfFailover.reason, CLOUD_REASONS.PROVIDER_FAILOVER_UNSAFE);

    // Valid failover from Gemini to Kimi revokes Gemini's lease and issues a fresh lease to Kimi.
    const safeFailover = prepareProviderFailoverHandoff({
      task: leased,
      handoff,
      nextProvider: CLOUD_PROVIDERS.KIMI,
      nextAgentIdentity: 'kimi-cloud-builder-01',
      nowIso: '2026-11-07T20:20:00Z',
    });
    assert.equal(safeFailover.ok, true);
    assert.equal(safeFailover.previous_task.state, CLOUD_TASK_STATES.REVOKED);
    assert.equal(safeFailover.previous_task.lease.revoked, true);
    assert.equal(safeFailover.next_task.provider, CLOUD_PROVIDERS.KIMI);
    assert.equal(safeFailover.next_task.agent_identity, 'kimi-cloud-builder-01');
    assert.equal(safeFailover.next_task.source_head, SAMPLE_SEMANTIC_HEAD);
    assert.equal(safeFailover.next_task.continuity_from.previous_provider, CLOUD_PROVIDERS.GEMINI);
    assert.equal(safeFailover.next_task.continuity_from.verified_semantic_head, SAMPLE_SEMANTIC_HEAD);

    // Adapter prepareHandoff preserves verified_semantic_head for failover continuation.
    const kimiBundle = kimiCloudAdapter().prepareHandoff(safeFailover.next_task);
    assert.equal(kimiBundle.starting_commit, SAMPLE_SEMANTIC_HEAD);

    // Failover from an uncertain task with valid reconciliation clearance clears execution_uncertain on the revoked previous lease.
    const uncertainLeased = markExecutionUncertain(leased, {
      reason: 'provider timeout',
      nowIso: '2026-11-07T20:25:00Z',
    });
    const failoverFromUncertain = prepareProviderFailoverHandoff({
      task: uncertainLeased,
      handoff,
      nextProvider: CLOUD_PROVIDERS.KIMI,
      nextAgentIdentity: 'kimi-cloud-builder-01',
      nowIso: '2026-11-07T20:30:00Z',
      reconciliationClearance: {
        clearance_id: 'CLR-CT-KF-META-CLOUD-DISPATCH-001-FAILOVER',
        task_id: uncertainLeased.task_id,
        packet_id: uncertainLeased.packet_id,
        uncertain_lease_id: uncertainLeased.lease.lease_id,
        cleared_attempt: uncertainLeased.attempt,
        cleared_by_provider: CLOUD_PROVIDERS.CHATGPT,
        author: 'SaCH-PRO',
        observed_branch_head: SAMPLE_PR_HEAD,
        disposition: 'CONTINUE_FROM_OBSERVED_HEAD',
      },
    });
    assert.equal(failoverFromUncertain.ok, true);
    assert.equal(failoverFromUncertain.previous_task.lease.execution_uncertain, false);
  });

  // -------------------------------------------------------------------------
  // Category 10: Missing or invalid task authority
  // -------------------------------------------------------------------------
  it('NC cloud missing authority: rejects tasks with missing authority or untrusted GitHub author', () => {
    const noAuthTask = makeTask({ authority: null });
    const noAuthRes = validateCloudTask(noAuthTask);
    assert.equal(noAuthRes.ok, false);
    assert.equal(noAuthRes.reason, CLOUD_REASONS.AUTHORITY_MISSING);

    const untrustedAuthorTask = makeTask({
      authority: {
        kind: 'OPERATOR_CLOUD_HANDOFF',
        reference: 'KF-META-CLOUD-DISPATCH-001',
        author: 'untrusted-external-user',
        merge_authority: false,
        production_touched: false,
        triggers_legacy_issue80: false,
      },
    });
    const untrustedRes = validateCloudTask(untrustedAuthorTask);
    assert.equal(untrustedRes.ok, false);
    assert.equal(untrustedRes.reason, CLOUD_REASONS.AUTHORITY_INVALID);
  });

  // -------------------------------------------------------------------------
  // Component B.2, C, D & E Integration Proofs
  // -------------------------------------------------------------------------
  it('verifies provider adapters, manual GitHub handoff, and explicit deferral of unattended API invocation', () => {
    const adapters = defaultCloudProviderRegistry();
    assert.equal(adapters.length, 4);
    assert.equal(geminiCloudAdapter().provider, CLOUD_PROVIDERS.GEMINI);
    assert.equal(kimiCloudAdapter().provider, CLOUD_PROVIDERS.KIMI);
    assert.equal(claudeCloudAdapter().provider, CLOUD_PROVIDERS.CLAUDE_CLOUD);
    assert.equal(chatgptAuthorityAdapter().provider, CLOUD_PROVIDERS.CHATGPT);

    const task = makeTask();
    const manualDispatch = dispatchCloudTask({
      task,
      nowIso: NOW_ISO,
      expectedMainSha: VERIFIED_MAIN_SHA,
    });
    assert.equal(manualDispatch.ok, true);
    assert.equal(manualDispatch.status, CLOUD_DISPATCH_STATUS.MANUAL_GITHUB_HANDOFF_READY);
    assert.equal(manualDispatch.handoff_bundle.automated_provider_invocation, 'DEFERRED_PHASE_2');

    const unattendedDispatch = dispatchCloudTask({
      task,
      nowIso: NOW_ISO,
      expectedMainSha: VERIFIED_MAIN_SHA,
      requireUnattended: true,
    });
    assert.equal(unattendedDispatch.ok, false);
    assert.equal(unattendedDispatch.status, CLOUD_DISPATCH_STATUS.DEFERRED_UNATTENDED_INVOCATION);
  });

  it('persists leases in FileBackedCloudRegistry and detects SHA-256 registry tampering', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-cloud-reg-'));
    try {
      const regFile = path.join(tmpDir, 'cloud-registry.json');
      const registry = new FileBackedCloudRegistry(regFile);
      const task = makeTask();

      const claim1 = registry.claimTask({
        task,
        claimantProvider: CLOUD_PROVIDERS.GEMINI,
        claimantAgentId: 'gemini-cloud-builder-01',
        nowIso: NOW_ISO,
      });
      assert.equal(claim1.ok, true);
      assert.equal(fs.existsSync(`${regFile}.lock`), false);

      const claim2 = registry.claimTask({
        task,
        claimantProvider: CLOUD_PROVIDERS.GEMINI,
        claimantAgentId: 'gemini-cloud-builder-01',
        nowIso: NOW_ISO,
      });
      assert.equal(claim2.ok, false);
      assert.equal(claim2.reason, CLOUD_REASONS.DUPLICATE_TASK_CLAIM);

      // Tamper with the registry file without updating sha256.
      const raw = JSON.parse(fs.readFileSync(regFile, 'utf8'));
      raw.idempotency_keys = [];
      fs.writeFileSync(regFile, JSON.stringify(raw, null, 2), 'utf8');

      assert.throws(
        () => registry.load(),
        (err) => err.reason === CLOUD_REASONS.REGISTRY_INTEGRITY_FAILED,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('validates completion recording, CLI preflight/rejection flags, and read-only workflow contract', () => {
    const leased = makeLeasedTask();
    const handoff = makeHandoff();
    const completed = recordTaskCompletion({
      task: leased,
      handoff,
      actorProvider: leased.provider,
      actorAgentId: leased.agent_identity,
      leaseId: leased.lease.lease_id,
      nowIso: '2026-11-07T20:15:00Z',
      currentMainSha: VERIFIED_MAIN_SHA,
      currentPrHeadSha: SAMPLE_PR_HEAD,
    });
    assert.equal(completed.ok, true);
    assert.equal(completed.task.state, CLOUD_TASK_STATES.COMPLETED_DRAFT);
    assert.equal(completed.task.source_head, SAMPLE_SEMANTIC_HEAD);

    // Terminal COMPLETED_DRAFT denies new execution ownership by default, but allows read-only preflight and still reserves its branch.
    const postCompleteExec = verifyTaskOwnership({
      task: completed.task,
      actorProvider: completed.task.provider,
      actorAgentId: completed.task.agent_identity,
      leaseId: completed.task.lease.lease_id,
      nowIso: '2026-11-07T20:20:00Z',
    });
    assert.equal(postCompleteExec.ok, false);

    const competingAgainstCompleted = evaluateLeaseAcquisition({
      task: makeTask({
        task_id: 'CT-KF-META-CLOUD-DISPATCH-999-001',
        packet_id: 'KF-META-OTHER-999',
        provider: CLOUD_PROVIDERS.KIMI,
        agent_identity: 'kimi-cloud-builder-01',
        implementation_branch: completed.task.implementation_branch,
      }),
      claimantProvider: CLOUD_PROVIDERS.KIMI,
      claimantAgentId: 'kimi-cloud-builder-01',
      nowIso: '2026-11-07T20:20:00Z',
      existingTasks: [completed.task],
    });
    assert.equal(competingAgainstCompleted.ok, false);
    assert.equal(competingAgainstCompleted.reason, CLOUD_REASONS.BRANCH_COLLISION);

    const preflight = evaluateCloudPreflight({
      task: completed.task,
      handoff,
      branchName: 'impl/kf-meta-cloud-control-001',
      headSha: SAMPLE_PR_HEAD,
      mainSha: VERIFIED_MAIN_SHA,
      changedFiles: handoff.changed_files,
      semanticHeadIsAncestor: true,
      nonControlTailFiles: [],
      nowIso: '2026-11-07T20:20:00Z',
    });
    assert.equal(preflight.ok, true);
    assert.equal(preflight.summary.mutating_actions_performed, 0);

    // Preflight rejects non-control files committed after semantic_head.
    const dirtyTailPreflight = evaluateCloudPreflight({
      task: completed.task,
      handoff,
      branchName: 'impl/kf-meta-cloud-control-001',
      headSha: SAMPLE_PR_HEAD,
      mainSha: VERIFIED_MAIN_SHA,
      changedFiles: handoff.changed_files,
      semanticHeadIsAncestor: true,
      nonControlTailFiles: ['scripts/agent-control/lib/cloud-control.mjs'],
      nowIso: '2026-11-07T20:20:00Z',
    });
    assert.equal(dirtyTailPreflight.ok, false);
    assert.equal(dirtyTailPreflight.reason, CLOUD_REASONS.STALE_COMPLETION_EVIDENCE);

    // CLI rejects mutating flags fail-closed.
    assert.equal(runCloudDispatchCli(['--merge']).exitCode, 2);
    assert.equal(runCloudDispatchCli(['--merge']).payload.reason, CLOUD_REASONS.MERGE_NOT_AUTHORIZED);
    assert.equal(runCloudDispatchCli(['--deploy']).exitCode, 2);
    assert.equal(runCloudDispatchCli(['--post-issue-80']).exitCode, 2);
    assert.equal(runCloudDispatchCli(['--status', '--dry-run']).exitCode, 0);

    // CLI validates YAML task and handoff files in a temp directory.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-cloud-cli-'));
    try {
      const taskPath = path.join(tmpDir, 'cloud-task.yaml');
      const handoffPath = path.join(os.tmpdir(), `kf-handoff-${process.pid}.yaml`);
      saveCloudYamlFile(taskPath, leased);
      saveCloudYamlFile(handoffPath, handoff);
      assert.equal(runCloudDispatchCli(['--validate-task', taskPath]).exitCode, 0);
      assert.equal(runCloudDispatchCli(['--validate-handoff', handoffPath, '--task', taskPath]).exitCode, 0);
      fs.rmSync(handoffPath, { force: true });
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // Verify .github/workflows/agent-cloud-control.yml is strictly read-only.
    const wfPath = path.resolve(process.cwd(), '.github/workflows/agent-cloud-control.yml');
    const wfText = fs.readFileSync(wfPath, 'utf8');
    const wf = parseYaml(wfText);
    assert.equal(wf.name, 'Agent Cloud Control Preflight');
    assert.equal(wf.permissions.contents, 'read');
    assert.equal(wf.permissions['pull-requests'], 'read');
    assert.equal(wf.permissions.issues, 'read');
    assert.equal(wfText.includes('--merge'), false);
  });
});

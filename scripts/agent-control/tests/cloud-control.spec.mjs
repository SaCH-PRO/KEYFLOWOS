/**
 * CLOUD-CONTROL PROOF SUITE — KF-META-CLOUD-DISPATCH-001
 *
 * Verifies Phase 1 Cloud-Native Multi-Agent Control Plane across all 10
 * mandatory adversarial and negative-control categories plus security-hardening
 * regression controls:
 *   1. Duplicate task claims
 *   2. Conflicting branches or ownership (plus scope violations)
 *   3. Expired and revoked leases
 *   4. Wrong provider or recipient (plus self-review prohibition)
 *   5. Invalid source commit & fail-closed missing git HEAD
 *   6. Unauthorized execution or merge requests (plus Issue #80 trigger block)
 *   7. Stale completion evidence, positive ancestry, and mandatory proof completion
 *   8. Replay after an uncertain execution result & immutable task contract under clearance
 *   9. Provider failure, safe cross-provider handoff, revoked/double-failover block, and continuity head precedence
 *  10. Missing, invalid, or unverified self-asserted YAML authority
 *  11. Local single-host registry lock safety (no age-based lock steal) and PR preflight trigger enforcement
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
  buildDefaultFailoverTaskId,
  buildDefaultLeaseId,
  buildVerifiedAuthorityRecord,
  buildVerifiedClearanceRecord,
  chatgptAuthorityAdapter,
  claudeCloudAdapter,
  computeTaskContractDigest,
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
  shouldRunPullRequestPreflight,
  validateCloudHandoff,
  validateCloudTask,
  verifyChangedFilesInScope,
  verifyCompletionProofs,
  verifyImmutableTaskContract,
  verifyTaskOwnership,
  verifyUncertainExecutionClearance,
} from '../lib/cloud-control.mjs';
import { runCloudDispatchCli } from '../cloud-dispatch.mjs';

const VERIFIED_MAIN_SHA = 'b1948d2797e1bae3660a3d7173abb75397e05aad';
const SAMPLE_SEMANTIC_HEAD = '3e00eb349dee7a95624faa1f358e5916e2744ecc';
const SAMPLE_PR_HEAD = 'fe533e2ef62633fcee95648e4c4eac828c4d14e0';
const STALE_HEAD = '1111111111111111111111111111111111111111';
const NOW_ISO = '2026-11-07T20:00:00Z';

const VALID_ANCESTRY = Object.freeze({
  sourceMainIsAncestorOfSemanticHead: true,
  semanticHeadIsAncestorOfPrHead: true,
});

function makeVerifiedCiEvidence(headSha = SAMPLE_PR_HEAD, overrides = {}) {
  return {
    head_sha: headSha,
    exact_head_ci_passed: true,
    satisfied_evidence: ['exact_head_ci_runs', 'negative_controls_manifest'],
    ...overrides,
  };
}

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
      'architecture/**',
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
  const verifiedAuthority = buildVerifiedAuthorityRecord(base);
  const acquired = evaluateLeaseAcquisition({
    task: base,
    claimantProvider: base.provider,
    claimantAgentId: base.agent_identity,
    leaseId: 'LEASE-CT-KF-META-CLOUD-DISPATCH-001-001',
    nowIso: NOW_ISO,
    ttlSeconds: 3600,
    verifiedAuthority,
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
      'architecture/dependency-map.md',
      'architecture/execution-paths.md',
      'architecture/architecture.json',
      'scripts/agent-control/tests/cloud-control.spec.mjs',
      'scripts/agent-control/negative-controls.yaml',
      '.agent-control/active-packet.yaml',
      '.agent-control/claude-return.yaml',
      '.agent-control/cloud-task.yaml',
      '.agent-control/cloud-handoff.yaml',
    ],
    decisions: [
      'D1: Keep Phase 1 cloud dispatch strictly read-only and draft-only with zero merge or production authority.',
      'D2: Block replay of uncertain executions even after lease expiry until ChatGPT records an authenticated reconciliation clearance.',
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
  it('validates a well-formed cloud engineering task envelope with authenticated authority and deterministic idempotency key', () => {
    const task = makeTask();
    const verifiedAuthority = buildVerifiedAuthorityRecord(task);
    const res = validateCloudTask(task, {
      expectedMainSha: VERIFIED_MAIN_SHA,
      verifiedAuthority,
    });
    assert.equal(res.ok, true);
    assert.equal(res.reason, CLOUD_REASONS.OK);
  });

  // -------------------------------------------------------------------------
  // Category 1: Duplicate task claims
  // -------------------------------------------------------------------------
  it('NC cloud duplicate task claim: rejects re-claiming an already-recorded idempotency key or active task', () => {
    const task = makeTask();
    const verifiedAuthority = buildVerifiedAuthorityRecord(task);
    const first = evaluateLeaseAcquisition({
      task,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: NOW_ISO,
      verifiedAuthority,
    });
    assert.equal(first.ok, true);

    const replayByKey = evaluateLeaseAcquisition({
      task,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: NOW_ISO,
      recordedIdempotencyKeys: [task.idempotency_key],
      verifiedAuthority,
    });
    assert.equal(replayByKey.ok, false);
    assert.equal(replayByKey.reason, CLOUD_REASONS.DUPLICATE_TASK_CLAIM);

    const replayByActiveTask = evaluateLeaseAcquisition({
      task,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: NOW_ISO,
      existingTasks: [first.task],
      verifiedAuthority,
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
      verifiedAuthority: buildVerifiedAuthorityRecord(competingBranchTask),
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
      verifiedAuthority: buildVerifiedAuthorityRecord(competingPacketTask),
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
      verifiedAuthority: buildVerifiedAuthorityRecord(leased),
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
      verifiedAuthority: buildVerifiedAuthorityRecord(revokedTask),
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
      verifiedAuthority: buildVerifiedAuthorityRecord(leased),
    });
    assert.equal(wrongProviderOwn.ok, false);
    assert.equal(wrongProviderOwn.reason, CLOUD_REASONS.WRONG_PROVIDER);

    const wrongRecipientTask = makeTask({
      provider: CLOUD_PROVIDERS.GEMINI,
      agent_identity: 'kimi-agent-spoof',
    });
    const wrongRecipientRes = validateCloudTask(wrongRecipientTask, {
      verifiedAuthority: buildVerifiedAuthorityRecord(wrongRecipientTask),
    });
    assert.equal(wrongRecipientRes.ok, false);
    assert.equal(wrongRecipientRes.reason, CLOUD_REASONS.WRONG_RECIPIENT);

    const selfReviewTask = makeTask({
      provider: CLOUD_PROVIDERS.GEMINI,
      agent_identity: 'gemini-reviewer-01',
      role: CLOUD_ROLES.ADVERSARIAL_REVIEWER,
      builder_provider: CLOUD_PROVIDERS.GEMINI,
      builder_agent_identity: 'gemini-cloud-builder-01',
    });
    const selfReviewRes = validateCloudTask(selfReviewTask, {
      verifiedAuthority: buildVerifiedAuthorityRecord(selfReviewTask),
    });
    assert.equal(selfReviewRes.ok, false);
    assert.equal(selfReviewRes.reason, CLOUD_REASONS.SELF_REVIEW_FORBIDDEN);

    const missingProvenanceReviewer = makeTask({
      provider: CLOUD_PROVIDERS.KIMI,
      agent_identity: 'kimi-reviewer-01',
      role: CLOUD_ROLES.ADVERSARIAL_REVIEWER,
    });
    const missingProvenanceRes = validateCloudTask(missingProvenanceReviewer, {
      verifiedAuthority: buildVerifiedAuthorityRecord(missingProvenanceReviewer),
    });
    assert.equal(missingProvenanceRes.ok, false);
    assert.equal(missingProvenanceRes.reason, CLOUD_REASONS.TASK_INVALID);
  });

  // -------------------------------------------------------------------------
  // Category 5: Invalid source commit & fail-closed missing git HEAD
  // -------------------------------------------------------------------------
  it('NC cloud invalid source commit: rejects malformed source_main or a commit not matching verified main', () => {
    const badShaTask = makeTask({ source_main: 'not-a-40-hex-commit-sha' });
    const badShaRes = validateCloudTask(badShaTask, {
      verifiedAuthority: buildVerifiedAuthorityRecord(badShaTask),
    });
    assert.equal(badShaRes.ok, false);
    assert.equal(badShaRes.reason, CLOUD_REASONS.INVALID_SOURCE_COMMIT);

    const driftedMainTask = makeTask();
    const driftedRes = validateCloudTask(driftedMainTask, {
      expectedMainSha: STALE_HEAD,
      verifiedAuthority: buildVerifiedAuthorityRecord(driftedMainTask),
    });
    assert.equal(driftedRes.ok, false);
    assert.equal(driftedRes.reason, CLOUD_REASONS.SOURCE_COMMIT_NOT_ON_MAIN);
  });

  it('NC cloud missing git head: preflight fails closed when headSha or branchName is missing or invalid', () => {
    const leased = makeLeasedTask();
    const handoff = makeHandoff({ pr_number: null });
    const verifiedAuthority = buildVerifiedAuthorityRecord(leased);

    const missingHeadPreflight = evaluateCloudPreflight({
      task: leased,
      handoff,
      branchName: leased.implementation_branch,
      headSha: null,
      mainSha: VERIFIED_MAIN_SHA,
      changedFiles: handoff.changed_files,
      sourceMainIsAncestor: true,
      semanticHeadIsAncestor: true,
      nonControlTailFiles: [],
      verifiedAuthority,
      nowIso: '2026-11-07T20:20:00Z',
    });
    assert.equal(missingHeadPreflight.ok, false);
    assert.equal(missingHeadPreflight.reason, CLOUD_REASONS.INVALID_SOURCE_COMMIT);

    const missingBranchPreflight = evaluateCloudPreflight({
      task: leased,
      handoff,
      branchName: null,
      headSha: SAMPLE_PR_HEAD,
      mainSha: VERIFIED_MAIN_SHA,
      changedFiles: handoff.changed_files,
      sourceMainIsAncestor: true,
      semanticHeadIsAncestor: true,
      nonControlTailFiles: [],
      verifiedAuthority,
      nowIso: '2026-11-07T20:20:00Z',
    });
    assert.equal(missingBranchPreflight.ok, false);
    assert.equal(missingBranchPreflight.reason, CLOUD_REASONS.TASK_INVALID);
  });

  // -------------------------------------------------------------------------
  // Category 6: Unauthorized execution, merge, production, or Issue #80 requests
  // -------------------------------------------------------------------------
  it('NC cloud unauthorized merge: rejects task envelopes requesting merge authority, production access, or Issue #80 directives', () => {
    const mergeTask = makeTask({ merge_authority: true });
    const mergeRes = validateCloudTask(mergeTask, {
      verifiedAuthority: buildVerifiedAuthorityRecord(mergeTask),
    });
    assert.equal(mergeRes.ok, false);
    assert.equal(mergeRes.reason, CLOUD_REASONS.MERGE_NOT_AUTHORIZED);

    const prodTask = makeTask({ production_touched: true });
    const prodRes = validateCloudTask(prodTask, {
      verifiedAuthority: buildVerifiedAuthorityRecord(prodTask),
    });
    assert.equal(prodRes.ok, false);
    assert.equal(prodRes.reason, CLOUD_REASONS.PRODUCTION_NOT_AUTHORIZED);

    const issue80Task = makeTask({ post_issue80_directive: true });
    const issue80Res = validateCloudTask(issue80Task, {
      verifiedAuthority: buildVerifiedAuthorityRecord(issue80Task),
    });
    assert.equal(issue80Res.ok, false);
    assert.equal(issue80Res.reason, CLOUD_REASONS.LEGACY_ISSUE80_TRIGGER_FORBIDDEN);
  });

  // -------------------------------------------------------------------------
  // Category 7: Stale completion evidence, positive ancestry & mandatory proofs
  // -------------------------------------------------------------------------
  it('NC cloud stale completion evidence: rejects handoff where evidence_head != pr_head or source_main is stale', () => {
    const leased = makeLeasedTask();
    const staleHandoff = makeHandoff({
      evidence_head: STALE_HEAD,
    });
    const staleRes = validateCloudHandoff(staleHandoff, {
      task: leased,
      verifiedAncestry: VALID_ANCESTRY,
    });
    assert.equal(staleRes.ok, false);
    assert.equal(staleRes.reason, CLOUD_REASONS.STALE_COMPLETION_EVIDENCE);

    const prodHandoff = makeHandoff({
      next_authorized_action: {
        action: 'AWAIT_INDEPENDENT_ARCHITECTURE_AND_ADVERSARIAL_REVIEW',
        assigned_provider: CLOUD_PROVIDERS.CHATGPT,
        merge_authority: false,
        production_touched: true,
      },
    });
    const prodHandoffRes = validateCloudHandoff(prodHandoff, {
      task: leased,
      verifiedAncestry: VALID_ANCESTRY,
    });
    assert.equal(prodHandoffRes.ok, false);
    assert.equal(prodHandoffRes.reason, CLOUD_REASONS.PRODUCTION_NOT_AUTHORIZED);

    const spoofedProviderHandoff = makeHandoff({
      provider: CLOUD_PROVIDERS.KIMI,
      agent_identity: 'kimi-cloud-builder-01',
    });
    const spoofedProviderRes = validateCloudHandoff(spoofedProviderHandoff, {
      task: leased,
      verifiedAncestry: VALID_ANCESTRY,
    });
    assert.equal(spoofedProviderRes.ok, false);
    assert.equal(spoofedProviderRes.reason, CLOUD_REASONS.WRONG_PROVIDER);
  });

  it('NC cloud unverified ancestry: rejects handoff when positive source_main or semantic_head ancestry is missing or false', () => {
    const leased = makeLeasedTask();
    const handoff = makeHandoff();

    // Missing verifiedAncestry fails closed.
    const missingAncestryRes = validateCloudHandoff(handoff, { task: leased });
    assert.equal(missingAncestryRes.ok, false);
    assert.equal(missingAncestryRes.reason, CLOUD_REASONS.STALE_COMPLETION_EVIDENCE);

    // False sourceMainIsAncestorOfSemanticHead fails closed.
    const badMainAncestryRes = validateCloudHandoff(handoff, {
      task: leased,
      verifiedAncestry: {
        sourceMainIsAncestorOfSemanticHead: false,
        semanticHeadIsAncestorOfPrHead: true,
      },
    });
    assert.equal(badMainAncestryRes.ok, false);
    assert.equal(badMainAncestryRes.reason, CLOUD_REASONS.STALE_COMPLETION_EVIDENCE);

    // False semanticHeadIsAncestorOfPrHead fails closed.
    const badSemanticAncestryRes = validateCloudHandoff(handoff, {
      task: leased,
      verifiedAncestry: {
        sourceMainIsAncestorOfSemanticHead: true,
        semanticHeadIsAncestorOfPrHead: false,
      },
    });
    assert.equal(badSemanticAncestryRes.ok, false);
    assert.equal(badSemanticAncestryRes.reason, CLOUD_REASONS.STALE_COMPLETION_EVIDENCE);
  });

  it('NC cloud failed proof completion: blocks COMPLETED_DRAFT when proof obligations fail, required_tests are missing, scope remains, or CI evidence is absent', () => {
    const leased = makeLeasedTask();
    const verifiedAuthority = buildVerifiedAuthorityRecord(leased);

    // Failing proof obligation status is rejected.
    const failedProofHandoff = makeHandoff({
      proof_obligations: [
        { id: 'PROOF-CLOUD-UNIT', command: 'node --test scripts/agent-control/tests/cloud-control.spec.mjs', status: 'FAIL' },
      ],
    });
    const failedProofRes = recordTaskCompletion({
      task: leased,
      handoff: failedProofHandoff,
      actorProvider: leased.provider,
      actorAgentId: leased.agent_identity,
      leaseId: leased.lease.lease_id,
      nowIso: '2026-11-07T20:15:00Z',
      currentMainSha: VERIFIED_MAIN_SHA,
      currentPrHeadSha: SAMPLE_PR_HEAD,
      verifiedAncestry: VALID_ANCESTRY,
      verifiedCiEvidence: makeVerifiedCiEvidence(),
      verifiedAuthority,
    });
    assert.equal(failedProofRes.ok, false);
    assert.equal(failedProofRes.reason, CLOUD_REASONS.PROOF_INCOMPLETE);

    // Unresolved scope_ledger.remaining items block COMPLETED_DRAFT.
    const unresolvedScopeHandoff = makeHandoff({
      scope_ledger: {
        declared: ['Cloud task contract', 'Lease ownership & collision gate'],
        resolved: ['Cloud task contract'],
        remaining: ['Lease ownership & collision gate'],
        deferred: [],
      },
    });
    const unresolvedScopeRes = recordTaskCompletion({
      task: leased,
      handoff: unresolvedScopeHandoff,
      actorProvider: leased.provider,
      actorAgentId: leased.agent_identity,
      leaseId: leased.lease.lease_id,
      nowIso: '2026-11-07T20:15:00Z',
      currentMainSha: VERIFIED_MAIN_SHA,
      currentPrHeadSha: SAMPLE_PR_HEAD,
      verifiedAncestry: VALID_ANCESTRY,
      verifiedCiEvidence: makeVerifiedCiEvidence(),
      verifiedAuthority,
    });
    assert.equal(unresolvedScopeRes.ok, false);
    assert.equal(unresolvedScopeRes.reason, CLOUD_REASONS.PROOF_INCOMPLETE);

    // Missing verifiedCiEvidence blocks COMPLETED_DRAFT.
    const missingCiRes = recordTaskCompletion({
      task: leased,
      handoff: makeHandoff(),
      actorProvider: leased.provider,
      actorAgentId: leased.agent_identity,
      leaseId: leased.lease.lease_id,
      nowIso: '2026-11-07T20:15:00Z',
      currentMainSha: VERIFIED_MAIN_SHA,
      currentPrHeadSha: SAMPLE_PR_HEAD,
      verifiedAncestry: VALID_ANCESTRY,
      verifiedCiEvidence: null,
      verifiedAuthority,
    });
    assert.equal(missingCiRes.ok, false);
    assert.equal(missingCiRes.reason, CLOUD_REASONS.PROOF_INCOMPLETE);
  });

  // -------------------------------------------------------------------------
  // Category 8: Replay after uncertain execution & immutable contract under clearance
  // -------------------------------------------------------------------------
  it('NC cloud uncertain execution replay: blocks replay even after lease expiry until authenticated ChatGPT clearance is provided', () => {
    const leased = makeLeasedTask();
    const uncertainTask = markExecutionUncertain(leased, {
      reason: 'cloud transport dropped before handoff artifact was recorded',
      nowIso: '2026-11-07T20:30:00Z',
    });
    const verifiedAuthority = buildVerifiedAuthorityRecord(uncertainTask);
    assert.equal(uncertainTask.state, CLOUD_TASK_STATES.UNCERTAIN_RESULT);
    assert.equal(uncertainTask.lease.execution_uncertain, true);

    // Even 3 hours later (after lease expiry), replay without clearance is blocked.
    const blockedReplay = evaluateLeaseAcquisition({
      task: uncertainTask,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: '2026-11-07T23:30:00Z',
      verifiedAuthority,
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
      verifiedAuthority: buildVerifiedAuthorityRecord(freshTaskAttempt),
    });
    assert.equal(bypassAttempt.ok, false);
    assert.equal(bypassAttempt.reason, CLOUD_REASONS.UNCERTAIN_EXECUTION_REPLAY_BLOCKED);

    // Forged clearance by non-ChatGPT provider is rejected.
    const forgedClearance = verifyUncertainExecutionClearance(
      uncertainTask,
      {
        clearance_id: 'CLR-CT-KF-META-CLOUD-DISPATCH-001-001',
        task_id: uncertainTask.task_id,
        packet_id: uncertainTask.packet_id,
        uncertain_lease_id: uncertainTask.lease.lease_id,
        cleared_attempt: uncertainTask.attempt,
        cleared_by_provider: CLOUD_PROVIDERS.GEMINI,
        author: 'SaCH-PRO',
        observed_branch_head: VERIFIED_MAIN_SHA,
        disposition: 'REPLAY_FROM_SOURCE_MAIN',
      },
      { observedBranchHead: VERIFIED_MAIN_SHA },
    );
    assert.equal(forgedClearance.ok, false);
    assert.equal(forgedClearance.reason, CLOUD_REASONS.RECONCILIATION_CLEARANCE_INVALID);

    // Clearance without an independent observedBranchHead fails closed.
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
    const missingObservedRes = verifyUncertainExecutionClearance(uncertainTask, validClearance, {
      observedBranchHead: null,
      verifiedClearance: buildVerifiedClearanceRecord(uncertainTask, validClearance),
    });
    assert.equal(missingObservedRes.ok, false);
    assert.equal(missingObservedRes.reason, CLOUD_REASONS.RECONCILIATION_CLEARANCE_INVALID);

    // Valid authenticated ChatGPT clearance bound to independent observedBranchHead permits controlled re-acquisition.
    const verifiedClearance = buildVerifiedClearanceRecord(uncertainTask, validClearance);
    const clearedReplay = evaluateLeaseAcquisition({
      task: uncertainTask,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: '2026-11-07T23:30:00Z',
      reconciliationClearance: validClearance,
      observedBranchHead: VERIFIED_MAIN_SHA,
      verifiedAuthority,
      verifiedClearance,
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
      observedBranchHead: VERIFIED_MAIN_SHA,
      consumedClearanceIds: [validClearance.clearance_id],
      verifiedAuthority,
      verifiedClearance,
    });
    assert.equal(replayedClearance.ok, false);
    assert.equal(replayedClearance.reason, CLOUD_REASONS.RECONCILIATION_CLEARANCE_INVALID);

    // CONTINUE_FROM_OBSERVED_HEAD binds source_head to observed_branch_head; ABORT_AND_REISSUE denies same-attempt claim.
    const uncertainAtSemantic = markExecutionUncertain(leased, {
      reason: 'provider dropped after semantic commit',
      nowIso: '2026-11-07T20:30:00Z',
      observedBranchHead: SAMPLE_SEMANTIC_HEAD,
    });
    const continueClearance = {
      ...validClearance,
      clearance_id: 'CLR-CT-KF-META-CLOUD-DISPATCH-001-002',
      observed_branch_head: SAMPLE_SEMANTIC_HEAD,
      disposition: 'CONTINUE_FROM_OBSERVED_HEAD',
    };
    const continuedReplay = evaluateLeaseAcquisition({
      task: uncertainAtSemantic,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: '2026-11-07T23:40:00Z',
      reconciliationClearance: continueClearance,
      observedBranchHead: SAMPLE_SEMANTIC_HEAD,
      verifiedAuthority: buildVerifiedAuthorityRecord(uncertainAtSemantic),
      verifiedClearance: buildVerifiedClearanceRecord(uncertainAtSemantic, continueClearance),
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
      observedBranchHead: VERIFIED_MAIN_SHA,
      verifiedAuthority,
      verifiedClearance: buildVerifiedClearanceRecord(uncertainTask, abortClearance),
    });
    assert.equal(abortedReplay.ok, false);
    assert.equal(abortedReplay.reason, CLOUD_REASONS.RECONCILIATION_CLEARANCE_INVALID);
  });

  it('NC cloud mutated reconciliation contract: rejects re-claiming an existing task with widened scope or altered contract fields', () => {
    const leased = makeLeasedTask();
    const uncertainTask = markExecutionUncertain(leased, {
      reason: 'transport timeout',
      nowIso: '2026-11-07T20:30:00Z',
      observedBranchHead: VERIFIED_MAIN_SHA,
    });
    const mutatedCandidate = makeTask({
      allowed_scope: ['**'],
      prohibited_scope: [],
    });
    const clearance = {
      clearance_id: 'CLR-CT-KF-META-CLOUD-DISPATCH-001-MUT',
      task_id: uncertainTask.task_id,
      packet_id: uncertainTask.packet_id,
      uncertain_lease_id: uncertainTask.lease.lease_id,
      cleared_attempt: uncertainTask.attempt,
      cleared_by_provider: CLOUD_PROVIDERS.CHATGPT,
      author: 'SaCH-PRO',
      observed_branch_head: VERIFIED_MAIN_SHA,
      disposition: 'REPLAY_FROM_SOURCE_MAIN',
    };

    const res = evaluateLeaseAcquisition({
      task: mutatedCandidate,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: '2026-11-07T23:30:00Z',
      existingTasks: [uncertainTask],
      reconciliationClearance: clearance,
      observedBranchHead: VERIFIED_MAIN_SHA,
      verifiedAuthority: buildVerifiedAuthorityRecord(mutatedCandidate),
      verifiedClearance: buildVerifiedClearanceRecord(uncertainTask, clearance),
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, CLOUD_REASONS.RECONCILIATION_CLEARANCE_INVALID);
  });

  // -------------------------------------------------------------------------
  // Category 9: Provider failure, safe cross-provider handoff, revoked/double failover block & continuity head precedence
  // -------------------------------------------------------------------------
  it('NC cloud provider failover: revokes previous provider lease and safely transfers continuity to a backup provider', () => {
    const leased = makeLeasedTask();
    const handoff = makeHandoff({ pr_number: null });
    const verifiedAuthority = buildVerifiedAuthorityRecord(leased);

    // Unsafe self-failover to the identical provider + agent is rejected.
    const unsafeSelfFailover = prepareProviderFailoverHandoff({
      task: leased,
      handoff,
      nextProvider: leased.provider,
      nextAgentIdentity: leased.agent_identity,
      nowIso: '2026-11-07T20:20:00Z',
      verifiedAuthority,
      verifiedAncestry: VALID_ANCESTRY,
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
      verifiedAuthority,
      verifiedAncestry: VALID_ANCESTRY,
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
      observedBranchHead: SAMPLE_PR_HEAD,
    });
    const failoverClearance = {
      clearance_id: 'CLR-CT-KF-META-CLOUD-DISPATCH-001-FAILOVER',
      task_id: uncertainLeased.task_id,
      packet_id: uncertainLeased.packet_id,
      uncertain_lease_id: uncertainLeased.lease.lease_id,
      cleared_attempt: uncertainLeased.attempt,
      cleared_by_provider: CLOUD_PROVIDERS.CHATGPT,
      author: 'SaCH-PRO',
      observed_branch_head: SAMPLE_PR_HEAD,
      disposition: 'CONTINUE_FROM_OBSERVED_HEAD',
    };
    const failoverFromUncertain = prepareProviderFailoverHandoff({
      task: uncertainLeased,
      handoff,
      nextProvider: CLOUD_PROVIDERS.KIMI,
      nextAgentIdentity: 'kimi-cloud-builder-01',
      nowIso: '2026-11-07T20:30:00Z',
      reconciliationClearance: failoverClearance,
      observedBranchHead: SAMPLE_PR_HEAD,
      verifiedAuthority: buildVerifiedAuthorityRecord(uncertainLeased),
      verifiedClearance: buildVerifiedClearanceRecord(uncertainLeased, failoverClearance),
      verifiedAncestry: VALID_ANCESTRY,
    });
    assert.equal(failoverFromUncertain.ok, true);
    assert.equal(failoverFromUncertain.previous_task.lease.execution_uncertain, false);
    assert.equal(failoverFromUncertain.consumed_clearance_id, failoverClearance.clearance_id);
  });

  it('NC cloud revoked failover: refuses to failover from a task or lease that is already REVOKED', () => {
    const leased = makeLeasedTask();
    const revokedTask = {
      ...leased,
      state: CLOUD_TASK_STATES.REVOKED,
      lease: {
        ...leased.lease,
        revoked: true,
        revoked_reason: 'operator revoked lease',
      },
    };
    const handoff = makeHandoff({ pr_number: null });
    const res = prepareProviderFailoverHandoff({
      task: revokedTask,
      handoff,
      nextProvider: CLOUD_PROVIDERS.KIMI,
      nextAgentIdentity: 'kimi-cloud-builder-01',
      nowIso: '2026-11-07T20:20:00Z',
      verifiedAuthority: buildVerifiedAuthorityRecord(revokedTask),
      verifiedAncestry: VALID_ANCESTRY,
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, CLOUD_REASONS.LEASE_REVOKED);
  });

  it('NC cloud double failover: blocks a second failover from the same task against persisted registry state', () => {
    const leased = makeLeasedTask();
    const handoff = makeHandoff({ pr_number: null });
    const verifiedAuthority = buildVerifiedAuthorityRecord(leased);

    const firstFailover = prepareProviderFailoverHandoff({
      task: leased,
      handoff,
      nextProvider: CLOUD_PROVIDERS.KIMI,
      nextAgentIdentity: 'kimi-cloud-builder-01',
      nowIso: '2026-11-07T20:20:00Z',
      existingTasks: [leased],
      verifiedAuthority,
      verifiedAncestry: VALID_ANCESTRY,
    });
    assert.equal(firstFailover.ok, true);

    // Even if a caller passes the pre-revocation `leased` object again while another active replacement exists in existingTasks:
    const forgedUnrevokedHistory = [
      leased,
      firstFailover.next_task,
    ];
    const secondFailover = prepareProviderFailoverHandoff({
      task: leased,
      handoff,
      nextProvider: CLOUD_PROVIDERS.CLAUDE_CLOUD,
      nextAgentIdentity: 'claude-cloud-builder-01',
      nowIso: '2026-11-07T20:25:00Z',
      existingTasks: forgedUnrevokedHistory,
      verifiedAuthority,
      verifiedAncestry: VALID_ANCESTRY,
    });
    assert.equal(secondFailover.ok, false);
    assert.equal(secondFailover.reason, CLOUD_REASONS.DUPLICATE_TASK_CLAIM);
  });

  it('NC cloud stale continuity head: prepareHandoff uses authoritative task.source_head after REPLAY_FROM_SOURCE_MAIN or CONTINUE_FROM_OBSERVED_HEAD', () => {
    const leased = makeLeasedTask();
    const handoff = makeHandoff({ pr_number: null });
    const failover = prepareProviderFailoverHandoff({
      task: leased,
      handoff,
      nextProvider: CLOUD_PROVIDERS.KIMI,
      nextAgentIdentity: 'kimi-cloud-builder-01',
      nowIso: '2026-11-07T20:20:00Z',
      verifiedAuthority: buildVerifiedAuthorityRecord(leased),
      verifiedAncestry: VALID_ANCESTRY,
    });
    assert.equal(failover.ok, true);

    // If the failover task becomes uncertain and is cleared with REPLAY_FROM_SOURCE_MAIN, source_head becomes null and starting_commit resets to source_main.
    const uncertainFailover = markExecutionUncertain(failover.next_task, {
      reason: 'kimi session timeout',
      nowIso: '2026-11-07T20:30:00Z',
      observedBranchHead: VERIFIED_MAIN_SHA,
    });
    const replayClearance = {
      clearance_id: 'CLR-CT-KF-META-CLOUD-DISPATCH-001-REPLAY',
      task_id: uncertainFailover.task_id,
      packet_id: uncertainFailover.packet_id,
      uncertain_lease_id: uncertainFailover.lease.lease_id,
      cleared_attempt: uncertainFailover.attempt,
      cleared_by_provider: CLOUD_PROVIDERS.CHATGPT,
      author: 'SaCH-PRO',
      observed_branch_head: VERIFIED_MAIN_SHA,
      disposition: 'REPLAY_FROM_SOURCE_MAIN',
    };
    const replayed = evaluateLeaseAcquisition({
      task: uncertainFailover,
      claimantProvider: CLOUD_PROVIDERS.KIMI,
      claimantAgentId: 'kimi-cloud-builder-01',
      nowIso: '2026-11-07T20:35:00Z',
      reconciliationClearance: replayClearance,
      observedBranchHead: VERIFIED_MAIN_SHA,
      verifiedAuthority: buildVerifiedAuthorityRecord(uncertainFailover),
      verifiedClearance: buildVerifiedClearanceRecord(uncertainFailover, replayClearance),
    });
    assert.equal(replayed.ok, true);
    assert.equal(replayed.task.source_head, null);

    const bundle = kimiCloudAdapter().prepareHandoff(replayed.task);
    assert.equal(bundle.source_head, null);
    assert.equal(bundle.starting_commit, VERIFIED_MAIN_SHA);
  });

  // -------------------------------------------------------------------------
  // Category 10: Missing, invalid, or unverified task authority
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

  it('NC cloud unverified authority: rejects self-asserted YAML author: SaCH-PRO or clearance when verifiedAuthority / verifiedClearance is missing or tampered', () => {
    const task = makeTask();
    // Raw YAML alone without verifiedAuthority must fail closed.
    const unverifiedRes = validateCloudTask(task);
    assert.equal(unverifiedRes.ok, false);
    assert.equal(unverifiedRes.reason, CLOUD_REASONS.UNVERIFIED_AUTHORITY);

    // Tampered contract_digest on verifiedAuthority must fail closed.
    const tamperedAuth = {
      ...buildVerifiedAuthorityRecord(task),
      contract_digest: '0'.repeat(64),
    };
    const tamperedRes = validateCloudTask(task, { verifiedAuthority: tamperedAuth });
    assert.equal(tamperedRes.ok, false);
    assert.equal(tamperedRes.reason, CLOUD_REASONS.UNVERIFIED_AUTHORITY);

    // Raw YAML clearance without verifiedClearance must fail closed.
    const leased = makeLeasedTask();
    const uncertainTask = markExecutionUncertain(leased, {
      reason: 'timeout',
      nowIso: '2026-11-07T20:30:00Z',
      observedBranchHead: VERIFIED_MAIN_SHA,
    });
    const clearance = {
      clearance_id: 'CLR-CT-KF-META-CLOUD-DISPATCH-001-UNVERIFIED',
      task_id: uncertainTask.task_id,
      packet_id: uncertainTask.packet_id,
      uncertain_lease_id: uncertainTask.lease.lease_id,
      cleared_attempt: uncertainTask.attempt,
      cleared_by_provider: CLOUD_PROVIDERS.CHATGPT,
      author: 'SaCH-PRO',
      observed_branch_head: VERIFIED_MAIN_SHA,
      disposition: 'REPLAY_FROM_SOURCE_MAIN',
    };
    const unverifiedClearanceRes = verifyUncertainExecutionClearance(uncertainTask, clearance, {
      observedBranchHead: VERIFIED_MAIN_SHA,
      verifiedClearance: null,
    });
    assert.equal(unverifiedClearanceRes.ok, false);
    assert.equal(unverifiedClearanceRes.reason, CLOUD_REASONS.UNVERIFIED_AUTHORITY);
  });

  // -------------------------------------------------------------------------
  // Category 11: Local single-host registry lock safety, max-length IDs & PR preflight trigger
  // -------------------------------------------------------------------------
  it('NC cloud stale lock steal: FileBackedCloudRegistry never steals an existing lock by age and verifies lock token before unlink', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-cloud-lock-'));
    try {
      const regFile = path.join(tmpDir, 'cloud-registry.json');
      assert.throws(
        () => new FileBackedCloudRegistry(regFile, { requireDistributedExclusivity: true }),
        (err) => err.reason === CLOUD_REASONS.REGISTRY_INTEGRITY_FAILED,
      );

      const registry = new FileBackedCloudRegistry(regFile, { lockTimeoutMs: 50 });
      assert.equal(registry.scope, 'LOCAL_SINGLE_HOST_ONLY');
      assert.equal(registry.cross_machine_exclusivity, false);

      // Simulate an existing lockfile with an old mtime (e.g., 10 minutes old) held by another token.
      const foreignLock = JSON.stringify({
        pid: 999999,
        token: 'foreign-holder-token',
        acquired_at: Date.now() - 600_000,
      });
      fs.writeFileSync(`${regFile}.lock`, foreignLock, 'utf8');
      const oldTime = new Date(Date.now() - 600_000);
      fs.utimesSync(`${regFile}.lock`, oldTime, oldTime);

      const task = makeTask();
      assert.throws(
        () =>
          registry.claimTask({
            task,
            claimantProvider: CLOUD_PROVIDERS.GEMINI,
            claimantAgentId: 'gemini-cloud-builder-01',
            nowIso: NOW_ISO,
            verifiedAuthority: buildVerifiedAuthorityRecord(task),
          }),
        (err) => err.reason === CLOUD_REASONS.REGISTRY_INTEGRITY_FAILED,
      );
      // Foreign lockfile must remain intact and never be unlinked by the timed-out waiter.
      assert.equal(fs.existsSync(`${regFile}.lock`), true);
      assert.equal(JSON.parse(fs.readFileSync(`${regFile}.lock`, 'utf8')).token, 'foreign-holder-token');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('NC cloud modified task preflight skip: shouldRunPullRequestPreflight forces preflight when cloud-task.yaml is modified with a mismatched branch', () => {
    const modifiedMismatch = shouldRunPullRequestPreflight({
      eventName: 'pull_request',
      declaredBranch: 'impl/other-branch-spoof',
      prHeadRef: 'impl/kf-meta-cloud-control-001',
      changedFilesSinceBase: ['.agent-control/cloud-task.yaml'],
    });
    assert.equal(modifiedMismatch.shouldRun, true);

    const untouchedOtherBranch = shouldRunPullRequestPreflight({
      eventName: 'pull_request',
      declaredBranch: 'impl/other-branch-untouched',
      prHeadRef: 'impl/kf-meta-cloud-control-001',
      changedFilesSinceBase: ['apps/web/README.md'],
    });
    assert.equal(untouchedOtherBranch.shouldRun, false);
  });

  it('generates valid default lease_id and failover task_id even for maximum-length (120-char body) task IDs', () => {
    const maxBody = 'A'.repeat(120);
    const maxTaskId = `CT-${maxBody}`;
    const maxTask = makeTask({ task_id: maxTaskId });
    const verifiedAuthority = buildVerifiedAuthorityRecord(maxTask);

    const leaseRes = evaluateLeaseAcquisition({
      task: maxTask,
      claimantProvider: CLOUD_PROVIDERS.GEMINI,
      claimantAgentId: 'gemini-cloud-builder-01',
      nowIso: NOW_ISO,
      verifiedAuthority,
    });
    assert.equal(leaseRes.ok, true);
    assert.match(leaseRes.lease.lease_id, /^LEASE-[A-Za-z0-9._-]{4,120}$/);

    const handoff = makeHandoff({
      task_id: maxTaskId,
      lease_id: leaseRes.lease.lease_id,
      pr_number: null,
    });
    const failoverRes = prepareProviderFailoverHandoff({
      task: leaseRes.task,
      handoff,
      nextProvider: CLOUD_PROVIDERS.KIMI,
      nextAgentIdentity: 'kimi-cloud-builder-01',
      nowIso: '2026-11-07T20:20:00Z',
      verifiedAuthority,
      verifiedAncestry: VALID_ANCESTRY,
    });
    assert.equal(failoverRes.ok, true);
    assert.match(failoverRes.next_task.task_id, /^CT-[A-Za-z0-9._-]{4,120}$/);
    assert.match(failoverRes.lease.lease_id, /^LEASE-[A-Za-z0-9._-]{4,120}$/);
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
    const verifiedAuthority = buildVerifiedAuthorityRecord(task);
    const manualDispatch = dispatchCloudTask({
      task,
      nowIso: NOW_ISO,
      expectedMainSha: VERIFIED_MAIN_SHA,
      verifiedAuthority,
    });
    assert.equal(manualDispatch.ok, true);
    assert.equal(manualDispatch.status, CLOUD_DISPATCH_STATUS.MANUAL_GITHUB_HANDOFF_READY);
    assert.equal(manualDispatch.handoff_bundle.automated_provider_invocation, 'DEFERRED_PHASE_2');

    const unattendedDispatch = dispatchCloudTask({
      task,
      nowIso: NOW_ISO,
      expectedMainSha: VERIFIED_MAIN_SHA,
      requireUnattended: true,
      verifiedAuthority,
    });
    assert.equal(unattendedDispatch.ok, false);
    assert.equal(unattendedDispatch.status, CLOUD_DISPATCH_STATUS.DEFERRED_UNATTENDED_INVOCATION);
  });

  it('persists leases and atomic failovers in FileBackedCloudRegistry and detects SHA-256 registry tampering', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kf-cloud-reg-'));
    try {
      const regFile = path.join(tmpDir, 'cloud-registry.json');
      const registry = new FileBackedCloudRegistry(regFile);
      const task = makeTask();
      const verifiedAuthority = buildVerifiedAuthorityRecord(task);

      const claim1 = registry.claimTask({
        task,
        claimantProvider: CLOUD_PROVIDERS.GEMINI,
        claimantAgentId: 'gemini-cloud-builder-01',
        leaseId: 'LEASE-CT-KF-META-CLOUD-DISPATCH-001-001',
        nowIso: NOW_ISO,
        verifiedAuthority,
      });
      assert.equal(claim1.ok, true);
      assert.equal(fs.existsSync(`${regFile}.lock`), false);

      const claim2 = registry.claimTask({
        task,
        claimantProvider: CLOUD_PROVIDERS.GEMINI,
        claimantAgentId: 'gemini-cloud-builder-01',
        nowIso: NOW_ISO,
        verifiedAuthority,
      });
      assert.equal(claim2.ok, false);
      assert.equal(claim2.reason, CLOUD_REASONS.DUPLICATE_TASK_CLAIM);

      // Atomic failover in registry revokes previous task and persists replacement task.
      const handoff = makeHandoff({ pr_number: null });
      const failover1 = registry.failoverTask({
        task: claim1.task,
        handoff,
        nextProvider: CLOUD_PROVIDERS.KIMI,
        nextAgentIdentity: 'kimi-cloud-builder-01',
        nowIso: '2026-11-07T20:20:00Z',
        verifiedAuthority,
        verifiedAncestry: VALID_ANCESTRY,
      });
      assert.equal(failover1.ok, true);

      // Attempting a second failover on the same task via registry fails closed.
      const failover2 = registry.failoverTask({
        task: claim1.task,
        handoff,
        nextProvider: CLOUD_PROVIDERS.CLAUDE_CLOUD,
        nextAgentIdentity: 'claude-cloud-builder-01',
        nowIso: '2026-11-07T20:25:00Z',
        verifiedAuthority,
        verifiedAncestry: VALID_ANCESTRY,
      });
      assert.equal(failover2.ok, false);
      assert.equal(failover2.reason, CLOUD_REASONS.LEASE_REVOKED);

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
    const verifiedAuthority = buildVerifiedAuthorityRecord(leased);
    const verifiedCiEvidence = makeVerifiedCiEvidence();

    const completed = recordTaskCompletion({
      task: leased,
      handoff,
      actorProvider: leased.provider,
      actorAgentId: leased.agent_identity,
      leaseId: leased.lease.lease_id,
      nowIso: '2026-11-07T20:15:00Z',
      currentMainSha: VERIFIED_MAIN_SHA,
      currentPrHeadSha: SAMPLE_PR_HEAD,
      verifiedAncestry: VALID_ANCESTRY,
      verifiedCiEvidence,
      verifiedAuthority,
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
      verifiedAuthority,
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
      verifiedAuthority: buildVerifiedAuthorityRecord(
        makeTask({
          task_id: 'CT-KF-META-CLOUD-DISPATCH-999-001',
          packet_id: 'KF-META-OTHER-999',
          provider: CLOUD_PROVIDERS.KIMI,
          agent_identity: 'kimi-cloud-builder-01',
          implementation_branch: completed.task.implementation_branch,
        }),
      ),
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
      sourceMainIsAncestor: true,
      semanticHeadIsAncestor: true,
      nonControlTailFiles: [],
      verifiedAuthority,
      verifiedCiEvidence,
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
      sourceMainIsAncestor: true,
      semanticHeadIsAncestor: true,
      nonControlTailFiles: ['scripts/agent-control/lib/cloud-control.mjs'],
      verifiedAuthority,
      verifiedCiEvidence,
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
      const handoffPath = path.join(tmpDir, 'cloud-handoff.yaml');
      const handoffReadyTask = {
        ...completed.task,
        state: CLOUD_TASK_STATES.HANDOFF_READY,
      };
      saveCloudYamlFile(taskPath, handoffReadyTask);
      saveCloudYamlFile(handoffPath, handoff);

      // Without verifiedAuthority, --validate-task fails closed.
      const unverifiedVal = runCloudDispatchCli(['--validate-task', taskPath], { cwd: tmpDir });
      assert.equal(unverifiedVal.exitCode, 1);
      assert.equal(unverifiedVal.payload.reason, CLOUD_REASONS.UNVERIFIED_AUTHORITY);

      // With verifiedAuthority, --validate-task and --validate-handoff succeed.
      const vTask = runCloudDispatchCli(['--validate-task', taskPath], {
        cwd: tmpDir,
        verifiedAuthority: buildVerifiedAuthorityRecord(handoffReadyTask),
      });
      assert.equal(vTask.exitCode, 0);

      const vHandoff = runCloudDispatchCli(['--validate-handoff', handoffPath, '--task', taskPath], {
        cwd: tmpDir,
        verifiedAncestry: VALID_ANCESTRY,
      });
      assert.equal(vHandoff.exitCode, 0);

      // Running --preflight in a non-git directory fails closed due to missing git HEAD.
      const nonGitPreflight = runCloudDispatchCli(['--preflight', '--task', taskPath], {
        cwd: tmpDir,
        verifiedAuthority: buildVerifiedAuthorityRecord(handoffReadyTask),
      });
      assert.equal(nonGitPreflight.exitCode, 1);
      assert.equal(nonGitPreflight.payload.reason, CLOUD_REASONS.INVALID_SOURCE_COMMIT);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

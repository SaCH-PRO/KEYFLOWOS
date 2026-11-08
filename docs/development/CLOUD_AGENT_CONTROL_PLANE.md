# Cloud-Native Multi-Agent Control Plane (`KF-META-CLOUD-DISPATCH-001`)

## 1. Architectural Mandate

KEYFLOWOS engineering operates under a permanent **mobile-first, cloud-native multi-agent architecture**:

- The operator directs all engineering from mobile through GitHub-connected cloud AI agents.
- **No personal computer, local PowerShell session, or PC-hosted background worker** is required for normal engineering, verification, or review.
- The legacy PC-hosted Claude worker (`scripts/agent-control/claude-worker.ps1`) remains retired under an active capacity hold (`CG-HOLD-CLAUDE-CAPACITY-20261106-001`, Issue #80 comment `6692411347`). Because the legacy selector (`scripts/agent-control/select-directive.mjs`) is recipient-blind, Phase 1 cloud dispatch **never** posts action-triggering `DIRECTIVE` or `REVIEW` comments to Issue #80.

---

## 2. Multi-Agent Provider Ecosystem

| Provider (`provider`) | Vendor | Permitted Roles | Agent Identity Prefix | Phase 1 Execution Mode |
| :--- | :--- | :--- | :--- | :--- |
| `chatgpt` | OpenAI | `architecture_authority`, `adversarial_reviewer` | `chatgpt-` | Coordination, authority issuance, reconciliation clearance, exact-head review |
| `gemini` | Google | `builder`, `adversarial_reviewer` | `gemini-` | Cloud-hosted engineering, implementation, and cross-provider review |
| `kimi` | Moonshot | `builder`, `adversarial_reviewer` | `kimi-` | Independent cloud engineering and adversarial testing/review |
| `claude-cloud` | Anthropic | `builder` | `claude-` | Optional cloud builder when capacity is available |
| `copilot` | GitHub | `adversarial_reviewer` | `copilot-` | Automated PR code review |

**Independence invariant:** No provider or agent identity may adversarially review a candidate built by the same provider or agent identity (`CLOUD_REASONS.SELF_REVIEW_FORBIDDEN`).

---

## 3. Phase 1 Foundation Components

### A. Cloud Task Contract (`keyflowos.cloud-task/v1`) & Authenticated Authority

Implemented in `scripts/agent-control/lib/cloud-control.mjs` (`validateCloudTask`, `validateTaskAuthority`, `computeTaskContractDigest`, `verifyImmutableTaskContract`) and stored per-branch at `.agent-control/cloud-task.yaml`.

Every task envelope requires:
- `schema`: `keyflowos.cloud-task/v1`
- `task_id`: Unique task identifier (`^CT-[A-Za-z0-9._-]{4,120}$`)
- `packet_id`: Programme packet identifier (`^KF-[A-Z0-9-]{3,80}$`)
- `provider` & `agent_identity`: Bound to `PROVIDER_CAPABILITIES`
- `role`: `builder` | `adversarial_reviewer` | `architecture_authority`
- `repository`: `SaCH-PRO/KEYFLOWOS`
- `source_main`: Exact 40-hex base commit SHA on `main`
- `source_head`: `null` on issuance, or exact 40-hex semantic commit SHA on completion
- `implementation_branch`: Isolated `impl/*` branch (`^impl\/[a-z0-9._-]{3,120}$`)
- `allowed_scope` & `prohibited_scope`: Repository-relative path globs verified by `verifyChangedFilesInScope`
- `required_tests` & `required_evidence`: Explicit verification obligations
- `risk_level`: `LOW` | `MEDIUM` | `HIGH` | `CRITICAL`
- `approval_level`: `DRAFT_EVALUATION_ONLY` | `PACKET_IMPLEMENTATION` | `ADMISSION_CANDIDATE` (autonomous merge and production deployment are excluded by construction)
- `authority`: Provenance block (`kind`, `reference`, `author` in `AUTHOR_ALLOWLIST`, `approval_id`, `contract_digest`, `merge_authority: false`, `production_touched: false`, `triggers_legacy_issue80: false`)
- `idempotency_key`: Deterministic `cloud_task:<task_id>:<packet_id>:<source_main>:<attempt>`
- `state` & `lease`: Lifecycle state and active lease binding

**Authenticated authority requirement (`CLOUD_REASONS.UNVERIFIED_AUTHORITY`):**
- Self-asserted YAML strings (`author: SaCH-PRO` or `cleared_by_provider: chatgpt`) are **never** trusted on their own.
- `validateTaskAuthority` and `validateCloudTask` require an independent authenticated `verifiedAuthority` record (`authenticated: true`, `approval_id`, `actor`, `source_kind`, `reference`, `task_id`, `packet_id`, `implementation_branch`, `source_main`, and `contract_digest === computeTaskContractDigest(task)`).
- `verifyUncertainExecutionClearance` requires both an independently observed git ref SHA (`observedBranchHead`) and an authenticated `verifiedClearance` record bound to `computeTaskContractDigest(task)`.
- `verifyImmutableTaskContract` prevents any reconciliation re-claim or duplicate submission from altering `packet_id`, `implementation_branch`, `provider`, `agent_identity`, `role`, `source_main`, `risk_level`, `approval_level`, `authority`, or `allowed_scope`/`prohibited_scope`.

### B. Ownership, Lease Semantics & Collision Protection

Implemented in `evaluateLeaseAcquisition`, `verifyTaskOwnership`, `verifyUncertainExecutionClearance`, and `FileBackedCloudRegistry`:
1. **No duplicate claims:** A task with an active lease or an already-recorded `idempotency_key` rejects duplicate claims (`CLOUD_REASONS.DUPLICATE_TASK_CLAIM`).
2. **No branch or packet collisions:** Two active or unresolved-uncertain tasks may never target the same `impl/*` branch (`CLOUD_REASONS.BRANCH_COLLISION`) or `packet_id` (`CLOUD_REASONS.PACKET_COLLISION`).
3. **Strict lease validity:** Expired (`nowIso >= lease.expires_at` -> `CLOUD_REASONS.LEASE_EXPIRED`) or revoked (`lease.revoked === true` -> `CLOUD_REASONS.LEASE_REVOKED`) leases authorize nothing.
4. **Uncertain execution replay gate:** If a cloud run times out, drops transport, or fails to produce a verified handoff record (`markExecutionUncertain`), the task enters `UNCERTAIN_RESULT` (`lease.execution_uncertain = true`). Replay, re-claim, and provider failover are blocked **even after lease expiry** (`CLOUD_REASONS.UNCERTAIN_EXECUTION_REPLAY_BLOCKED`) until `chatgpt` (`SaCH-PRO`) supplies an authenticated `reconciliation_clearance` + `verifiedClearance` bound to the independently observed `observedBranchHead` and immutable task contract digest.
5. **Local single-host registry boundary (`LOCAL_SINGLE_HOST_ONLY`):** `FileBackedCloudRegistry` is explicitly scoped to local single-host persistence (`scope: 'LOCAL_SINGLE_HOST_ONLY'`, `cross_machine_exclusivity: false`) and rejects `requireDistributedExclusivity: true`. It never deletes an active lockfile by age (`lockStaleMs` reclamation is forbidden), verifies lock token ownership before unlink, and executes `claimTask()` and `failoverTask()` atomically under `withLock()`. Distributed cross-machine lease exclusivity across separate cloud runners is not enforced in Phase 1 (deferred to Phase 2 alongside shared GitHub-backed lease state); GitHub workflow concurrency groups serialize only read-only preflight runs per PR/ref.

### C. Provider-Neutral Cloud Execution Interface

Implemented in `geminiCloudAdapter`, `kimiCloudAdapter`, `claudeCloudAdapter`, `chatgptAuthorityAdapter`, and `dispatchCloudTask`:
- **Implemented in Phase 1:** Validated, lease-checked GitHub-native manual cloud handoff (`CLOUD_DISPATCH_STATUS.MANUAL_GITHUB_HANDOFF_READY`). In `prepareHandoff`, `task.source_head` is authoritative when defined (`null` after `REPLAY_FROM_SOURCE_MAIN` resets starting commit to `source_main`), falling back to `continuity_from.verified_semantic_head` only when `source_head` is undefined.
- **Explicitly Deferred to Phase 2:** Unattended outbound API invocation of external cloud agents (`automated_provider_invocation: 'DEFERRED_PHASE_2'`). Calling `dispatchCloudTask(..., { requireUnattended: true })` fails closed with `DEFERRED_UNATTENDED_INVOCATION` rather than faking remote execution.

### D. GitHub-Native Read-Only Control

- **CLI (`scripts/agent-control/cloud-dispatch.mjs`):**
  - `node scripts/agent-control/cloud-dispatch.mjs --preflight --dry-run --json`
  - `node scripts/agent-control/cloud-dispatch.mjs --validate-task <path>`
  - `node scripts/agent-control/cloud-dispatch.mjs --validate-handoff <path>`
  - `node scripts/agent-control/cloud-dispatch.mjs --status --dry-run --json`
  - Fails closed when git `HEAD`, branch name, `trustedMainSha`, `git merge-base`, `git diff`, or authenticated authority (`--verified-authority` or verified `GITHUB_EVENT_PATH`) is missing or invalid.
  - Rejects `--merge`, `--deploy`, `--touch-production`, and `--post-issue-80` with exit code `2`.
- **Workflow (`.github/workflows/agent-cloud-control.yml`):**
  - Runs on `pull_request` and `workflow_dispatch` with `contents: read`, `pull-requests: read`, `issues: read`.
  - Executes `scripts/agent-control/tests/cloud-control.spec.mjs` and `cloud-dispatch.mjs --preflight`.
  - Runs `--preflight` whenever `.agent-control/cloud-task.yaml` or `.agent-control/cloud-handoff.yaml` is modified in the PR diff (`shouldRunPullRequestPreflight`), even if `implementation_branch` was set to a different branch name, so mismatched branch bindings fail closed.

### E. Durable Continuity, Verified Completion & Cross-Provider Failover (`keyflowos.cloud-handoff/v1`)

Implemented in `validateCloudHandoff`, `verifyCompletionProofs`, `recordTaskCompletion`, and `prepareProviderFailoverHandoff` (`.agent-control/cloud-handoff.yaml`):
- Records `source_main`, `semantic_head`, `pr_head`, `evidence_head`, `pr_number`, `changed_files`, `decisions`, `scope_ledger` (`declared`, `resolved`, `remaining`, `deferred`), `proof_obligations`, and `next_authorized_action` (`merge_authority: false`, `production_touched: false`).
- Requires positive ancestry verification (`verifiedAncestry: { sourceMainIsAncestorOfSemanticHead: true, semanticHeadIsAncestorOfPrHead: true }`) and rejects stale evidence (`CLOUD_REASONS.STALE_COMPLETION_EVIDENCE`).
- Requires all `proof_obligations` to have `status: 'PASS'` and cover every `task.required_tests` command (`verifyCompletionProofs` -> `CLOUD_REASONS.PROOF_INCOMPLETE`). Transitioning a task to `COMPLETED_DRAFT` additionally requires `scope_ledger.remaining` to be empty, all `scope_ledger.declared` items resolved, and `verifiedCiEvidence` at `currentPrHeadSha`. While a draft PR is awaiting exact-head CI completion, `.agent-control/cloud-task.yaml` remains in `state: HANDOFF_READY`.
- `prepareProviderFailoverHandoff` rejects already-revoked tasks (`CLOUD_REASONS.LEASE_REVOKED`) and duplicate failover attempts against `existingTasks` (`CLOUD_REASONS.DUPLICATE_TASK_CLAIM`), revokes the prior provider's lease, increments `attempt`, binds a length-safe deterministic `task_id` (`buildDefaultFailoverTaskId`) and `lease_id` (`buildDefaultLeaseId`), and transfers continuity to a distinct backup provider.

---

## 4. Branch History & Audit Trail Note (`impl/kf-meta-cloud-control-001`)

During initial Phase 1 draft iteration on `impl/kf-meta-cloud-control-001` (PR #194), commit `583a1e2dd83a4330879b887ce52c6a81d6a37edb` (semantic parent `3e00eb349dee7a95624faa1f358e5916e2744ecc`) was replaced via `--force-with-lease` by `7e94299a780248184b64789564757f762a879fb6` (semantic parent `504d35178839459abebd7ac57213e4a65959264c`). In accordance with `docs/branch-hygiene-policy.md` Rule 4, the pre-reset commit is preserved in the remote archive tag `archive/impl-kf-meta-cloud-control-001-pre-reset-2026-11-07` (`583a1e2dd83a4330879b887ce52c6a81d6a37edb`), and all subsequent updates on `impl/kf-meta-cloud-control-001` are strictly append-only.

---

## 5. Phase 2 Roadmap (Gemini + Kimi + ChatGPT Automated Collaboration)

1. **Recipient-Bound Authority Envelope (`control-envelope/v2`):**
   Extend the authority parser and selector to require explicit `recipient_provider`, `recipient_agent_id`, and `task_id` fields so Issue #80 (or a dedicated GitHub Discussion / control issue) can carry multi-agent directives without waking legacy recipient-blind tooling.
2. **GitHub App / OIDC Unattended Dispatch Bridge:**
   Connect `.github/workflows/agent-cloud-control.yml` to authenticated cloud-agent session endpoints with short-lived leases and heartbeat renewal.
3. **Automated Cross-Vendor Adversarial Review Gate:**
   Require a signed `keyflowos.cloud-handoff/v1` review artifact from a distinct vendor (`kimi` or `chatgpt` for `gemini` builds) before `auto-merge-admitted.mjs` evaluates merge readiness.
4. **Programme-State Reducer Integration:**
   After PR #193 is formally admitted on `main`, fold `CLOUD_TASK_CLAIMED`, `CLOUD_TASK_FAILOVER`, and `CLOUD_HANDOFF_RECORDED` transitions into `scripts/agent-control/lib/state.mjs`.

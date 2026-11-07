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

### A. Cloud Task Contract (`keyflowos.cloud-task/v1`)

Implemented in `scripts/agent-control/lib/cloud-control.mjs` (`validateCloudTask`) and stored per-branch at `.agent-control/cloud-task.yaml`.

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
- `authority`: Provenance block (`kind`, `reference`, `author` in `AUTHOR_ALLOWLIST`, `merge_authority: false`, `production_touched: false`, `triggers_legacy_issue80: false`)
- `idempotency_key`: Deterministic `cloud_task:<task_id>:<packet_id>:<source_main>:<attempt>`
- `state` & `lease`: Lifecycle state and active lease binding

### B. Ownership, Lease Semantics & Collision Protection

Implemented in `evaluateLeaseAcquisition`, `verifyTaskOwnership`, `verifyUncertainExecutionClearance`, and `FileBackedCloudRegistry`:
1. **No duplicate claims:** A task with an active lease or an already-recorded `idempotency_key` rejects duplicate claims (`CLOUD_REASONS.DUPLICATE_TASK_CLAIM`).
2. **No branch or packet collisions:** Two active or unresolved-uncertain tasks may never target the same `impl/*` branch (`CLOUD_REASONS.BRANCH_COLLISION`) or `packet_id` (`CLOUD_REASONS.PACKET_COLLISION`).
3. **Strict lease validity:** Expired (`nowIso >= lease.expires_at` -> `CLOUD_REASONS.LEASE_EXPIRED`) or revoked (`lease.revoked === true` -> `CLOUD_REASONS.LEASE_REVOKED`) leases authorize nothing.
4. **Uncertain execution replay gate:** If a cloud run times out, drops transport, or fails to produce a verified handoff record (`markExecutionUncertain`), the task enters `UNCERTAIN_RESULT` (`lease.execution_uncertain = true`). Replay, re-claim, and provider failover are blocked **even after lease expiry** (`CLOUD_REASONS.UNCERTAIN_EXECUTION_REPLAY_BLOCKED`) until `chatgpt` (`SaCH-PRO`) supplies a `reconciliation_clearance` bound to the verified `observed_branch_head`.
5. **Tamper-evident persistence:** `FileBackedCloudRegistry` persists task and idempotency state with a SHA-256 integrity digest (`CLOUD_REASONS.REGISTRY_INTEGRITY_FAILED` on mismatch).

### C. Provider-Neutral Cloud Execution Interface

Implemented in `geminiCloudAdapter`, `kimiCloudAdapter`, `claudeCloudAdapter`, `chatgptAuthorityAdapter`, and `dispatchCloudTask`:
- **Implemented in Phase 1:** Validated, lease-checked GitHub-native manual cloud handoff (`CLOUD_DISPATCH_STATUS.MANUAL_GITHUB_HANDOFF_READY`).
- **Explicitly Deferred to Phase 2:** Unattended outbound API invocation of external cloud agents (`automated_provider_invocation: 'DEFERRED_PHASE_2'`). Calling `dispatchCloudTask(..., { requireUnattended: true })` fails closed with `DEFERRED_UNATTENDED_INVOCATION` rather than faking remote execution.

### D. GitHub-Native Read-Only Control

- **CLI (`scripts/agent-control/cloud-dispatch.mjs`):**
  - `node scripts/agent-control/cloud-dispatch.mjs --preflight --dry-run --json`
  - `node scripts/agent-control/cloud-dispatch.mjs --validate-task <path>`
  - `node scripts/agent-control/cloud-dispatch.mjs --validate-handoff <path>`
  - `node scripts/agent-control/cloud-dispatch.mjs --status --dry-run --json`
  - Rejects `--merge`, `--deploy`, `--touch-production`, and `--post-issue-80` with exit code `2`.
- **Workflow (`.github/workflows/agent-cloud-control.yml`):**
  - Runs on `pull_request` and `workflow_dispatch` with `contents: read`, `pull-requests: read`, `issues: read`.
  - Executes `scripts/agent-control/tests/cloud-control.spec.mjs` and `cloud-dispatch.mjs --preflight`.

### E. Durable Continuity & Cross-Provider Failover (`keyflowos.cloud-handoff/v1`)

Implemented in `validateCloudHandoff`, `recordTaskCompletion`, and `prepareProviderFailoverHandoff` (`.agent-control/cloud-handoff.yaml`):
- Records `source_main`, `semantic_head`, `pr_head`, `evidence_head`, `pr_number`, `changed_files`, `decisions`, `scope_ledger` (`declared`, `resolved`, `remaining`, `deferred`), `proof_obligations`, and `next_authorized_action` (`merge_authority: false`).
- Rejects stale evidence where `evidence_head !== pr_head`, `semantic_head` is not an ancestor of `pr_head`, or `source_main` / `lease_id` drifts from the task (`CLOUD_REASONS.STALE_COMPLETION_EVIDENCE`).
- `prepareProviderFailoverHandoff` revokes the prior provider's lease, increments `attempt`, binds a fresh deterministic `idempotency_key`, preserves `continuity_from` pointing to the verified `semantic_head` and `pr_head`, and issues a new lease to the backup provider (e.g., Gemini -> Kimi or Claude Cloud -> Gemini).

---

## 4. Phase 2 Roadmap (Gemini + Kimi + ChatGPT Automated Collaboration)

1. **Recipient-Bound Authority Envelope (`control-envelope/v2`):**
   Extend the authority parser and selector to require explicit `recipient_provider`, `recipient_agent_id`, and `task_id` fields so Issue #80 (or a dedicated GitHub Discussion / control issue) can carry multi-agent directives without waking legacy recipient-blind tooling.
2. **GitHub App / OIDC Unattended Dispatch Bridge:**
   Connect `.github/workflows/agent-cloud-control.yml` to authenticated cloud-agent session endpoints with short-lived leases and heartbeat renewal.
3. **Automated Cross-Vendor Adversarial Review Gate:**
   Require a signed `keyflowos.cloud-handoff/v1` review artifact from a distinct vendor (`kimi` or `chatgpt` for `gemini` builds) before `auto-merge-admitted.mjs` evaluates merge readiness.
4. **Programme-State Reducer Integration:**
   After PR #193 is formally admitted on `main`, fold `CLOUD_TASK_CLAIMED`, `CLOUD_TASK_FAILOVER`, and `CLOUD_HANDOFF_RECORDED` transitions into `scripts/agent-control/lib/state.mjs`.

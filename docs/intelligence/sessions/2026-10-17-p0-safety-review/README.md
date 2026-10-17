# P0 repository safety review — 17 October 2026

**Review evidence; no implementation release, admission, merge grant or programme completion credit.**

The repository-only P0 review is complete at the revisions below. PR #155 receives a **narrow semantic PASS** for its parsed-command fail-closed boundary. The existing **F9 merge-authority defect remains reproducible on main**. The separate Flow chat trace confirms two unresolved authority defects, including fresh evidence for the already-recorded client-supplied job-role envelope finding.

This is a dated evidence snapshot under the existing intelligence branch. It does not replace issue #80, the programme reducer, the current worker assignment, or the finding registers. Runtime implementation remains unchanged. The review was performed by ChatGPT (GPT-6 Astra Pro), independently of the Claude-authored PR #155 source, with parallel source review and local characterization.

## 1. Scope, state and source identity

| Item | Verified identity or disposition |
| --- | --- |
| Runtime main | `98ee0202499ba87fa4ee13d58a2a9075016225bd` |
| PR #155 semantic head | `fe79181638e373584c3ca3184a39343a132040cd` |
| PR #155 final artifact head | `a597c692fcb102de558dd832d88738c0402f69a2` — open, draft, unmerged |
| Prior reviewed PR #155 head | `8987f6db21a839f90c88e33479768d81cef508e9` — historical evidence only |
| H1 PR #179 head | `b9baa28f7b637e6f0f6a3a0dddbc8418570c1ce5` — open, draft; no RETURN at collection cutoff |
| Intelligence base | `docs/keyflow-intelligence-foundation` at `f406d15c12d56e3758b517161f8e7c2ddc30424a` |
| Authority collection | All 1,422 issue #80 comments through comment `6230334535`; completed 2026-10-17 05:59:38 UTC |
| Effective application packet | `KF-EXEC-AUTH-FAIL-CLOSED-001`; `FIXING_PROOF_FAILURES`; `YELLOW`; merge authority false |
| Latest worker authority | `CG-DIR-HANDOFF-UI-001`, H1, comment `6229570731` |
| Review activity | Technical proof complete; durable findings and safe review transport prepared |

The application packet state and latest worker directive are different projections and must remain distinct. This review does not mark the implementation packet complete. Its admission, merge and post-merge obligations remain open. The repository completion contract explicitly separates proof, admission, merge and durable checkpointing. [Execution standard][execution-standard]

### Scope ledger

| Category | Accounting |
| --- | --- |
| Declared | Recover current authority; characterize F9; independently review current PR #155; trace the shipped Flow authorization path separately; preserve H1; save evidence. |
| Resolved in this review | Exact revisions and replay established; F9 reproduced; PR #155 focused proof and eight controls reproduced; Flow findings independently checked; correction boundaries recorded. |
| Remaining implementation obligations | F9 repair; separately scoped Flow authority repairs; formal PR #155 review/admission transport at a safe handoff; any subsequent admission, merge and post-merge verification. |
| Deferred with reason | A typed #80 REVIEW or ruling would displace the active H1 assignment under the current selector. Evidence can be posted now; authority-bearing review waits for a safe handoff. No F9 implementation directive exists in the retrieved history. |
| Dropped | None. |
| Superseded interpretation | The old ACTION-001 hold is not active. The old reducer-reanchor rationale is technically obsolete after #159; a formal disposition of the earlier instruction is still owed. |

## 2. Live authority: consistent replay, stale narrative fields

The unchanged main parser, reducer and reconciler were run against the complete comment collection. Twelve source modules and inputs were checked against their Git blob identities. The fold reaches **generation 116 of 116**, applying all 29 effects after the existing generation-87 checkpoint. Collection contains 109 valid messages, seven historical malformed candidates and two rejected messages. The checkpoint is valid; the fold has no blocked or unapplied effects; reconciliation reports `CONSISTENT` with no findings. The seven malformed candidates precede the checkpoint and remain disclosed as historical evidence. See [authority evidence](authority/README.md).

Three consequences follow from the actual fold:

1. **ACTION-001 has no active hold.** The valid [RESUME/HOLD_CLEAR, comment 5998716917][action-resume], explicitly cleared it. The following implementation release, admission and checkpoint are preserved in the replay. Old hold text retained in history is not an active prohibition. Clearance of that historical hold does not release additional work.
2. **The reducer blockage behind the old reanchor request is resolved.** Main includes #159's explicit compatibility aliases for generations 102 and 103. All newer effects now apply from the existing checkpoint. A checkpoint rewrite or ancestry reanchor is unnecessary to make this replay consistent. The earlier [review request][old-review] and [builder contradiction][old-contradiction] still require an explicit formal disposition; this report does not silently retire them or grant admission.
3. **Descriptive residue is not fresh authority.** For example, the folded checkpoint still carries historical `next_legal_action` text saying ACTION-001 is held, while the effective hold record says `active: false`. The recovery draft #177 also retains categorical held wording at its current head. These are stale descriptions to correct through their existing owners, not grounds to override the explicit hold-clear effect.

The latest authority is still the [H1 directive][h1-directive]. The latest retrieved [PROGRESS][p0-progress] explicitly aligns repo-only work with P0 F9 and #155 while H1 continues. The existing [review-routing authorization][routing-authority] permits review findings through GitHub; it does not authorize an unrelated implementation dispatch.

### Why this review uses PROGRESS on #80

The actual `collectAuthority` and `selectDirective` functions were exercised against the collected history. Appending a PROGRESS preserves 116 candidates and H1 as the selected directive. Changing the same envelope to REVIEW creates a 117th candidate and replaces H1, even with `NO_STATE_CHANGE` and no merge grant. [Selector][selector] and [parser][parser]

A PR #155 review-evidence comment and a #80 PROGRESS therefore preserve the active assignment. They are **not a substitute for the valid, unedited #80 REVIEW required by the semantic-review contract**. Machine admission remains pending. At the H1 RETURN or another explicitly safe handoff, re-resolve the current head and authority before emitting a typed review or formal contradiction ruling.

## 3. F9: the existing merge-authority defect is confirmed

**Disposition: unresolved; implementation not released by this report.** Keep the existing F9 identity recorded in main's return artifact. This is stronger evidence for that finding, not a new control-plane architecture. [Existing F9 record][f9-record]

### Source mechanism

`evaluateAdmission` accepts `READY_TO_MERGE` and `ACCEPT_FOR_ADMISSION`, and its readiness check inspects the returned status rather than a distinct grant. It never reads either artifact's `merge_authority` field. The non-draft workflow step likewise accepts either status without checking a grant. [Admission evaluator][admission] and [gate][gate]

The actual auto-merge runner obtains semantic-review evidence, workflows, artifact binding and two snapshots. It does not collect current control-room grant or hold authority. A valid primary Copilot PASS can satisfy its semantic-review branch without a ChatGPT issue comment. The event/manual and hourly workflow jobs call this runner with `--merge`; neither is gated by the observer's reconciliation result. [Runner][merge-runner] and [autopilot workflow][autopilot]

### Local proof on unchanged main

| Characterization | Observed result |
| --- | --- |
| Existing admission suite | 39 passed; zero skipped |
| Both accepted statuses × absent, false, null, zero, string `false`, string `true` grant fields | All 12 cases reported eligible |
| Draft, correction status, missing independent review, base drift, pending required workflow, wrong packet controls | All six correctly rejected |
| Actual CLI with a completely replaced `fetch`, synthetic repository and synthetic credential | Two snapshots, then one simulated merge PUT despite both grant flags being false |
| Exact Bash non-draft step, extracted from main | Both accepted statuses passed with false grants; `CORRECTION_REQUIRED` failed |

The fetch fixture never forwards a request. No remote merge, real grant, repository mutation, or production action was performed. All synthetic CI/review successes in that fixture are labelled as such. Passing characterization assertions mean the defect was observed; they do not mean it is repaired. Evidence and portable reproductions are in [f9/](f9/README.md).

The risk is conditional on all other eligibility checks and the runner's GitHub permissions/protection settings. This evidence does not establish an actual unauthorized merge or a bypass available to an arbitrary unauthenticated party. It establishes that distinct merge authority is absent from the decision even when semantic and workflow evidence are otherwise sufficient.

### Bounded proposed correction contract

Strengthen the existing collector, admission evaluator, pre-merge recheck and non-draft gate. Use one shared predicate for a distinct, verified, current grant bound to the repository, PR, packet, branch, semantic revision, final artifact revision and base as the approved contract requires. Status strings and builder-controlled grant flags cannot themselves be authority. Preserve independent semantic review and CI as additional requirements. [Current authority effects][authority-effects]

Required failure cases include absent, malformed, forged, edited, stale, revoked and mismatched grants; relevant active holds; head/base changes; missing review; and a change between the two snapshots. Preserve valid meta-package review flows and legitimate independent-review failover. Two design traps require explicit treatment before implementation:

- A blanket global `READY_TO_MERGE` requirement would couple target-specific meta corrections to the active application packet and can recreate deadlock. Define target-scoped authority within the existing owner instead of adding a second control plane.
- Calling the full admission evaluator from the unfinished CI gate can require that gate's own successful run. Share a grant predicate without introducing this self-dependency. Likewise, avoid a final-SHA artifact binding that requires an endless commit rewrite.

Shared-account identity remains an attestation limit. A last-read check followed by a SHA-pinned GitHub merge is not atomic with later changes to issue comments; the residual race must be stated rather than claimed away. This is a review-ready correction charter, not an issued directive or completed fix.

## 4. PR #155: fresh narrow semantic PASS

**Verdict: PASS at semantic head `fe79181638e373584c3ca3184a39343a132040cd`, integrated artifact head `a597c692fcb102de558dd832d88738c0402f69a2`. Zero newly identified blocking findings inside the declared parsed-command boundary. Merge authority remains false.**

The three semantic/proof files are byte-for-byte unchanged from the previously reviewed `8987f6db` and between the current semantic and artifact heads. The current five-file diff also includes the two control artifacts. Nevertheless, the current integrated source was read again, its authority producers were traced, and its proof was independently rerun. [PR #155][pr155]

### What the patch establishes

The executable parsed-command accumulator starts empty. Approvals are published only after every command in the batch has been evaluated, so a later thrown check or unusable verdict cannot leak an approved prefix. The validator requires booleans for `allowed` and `requiresApproval`, plus a recognized tier. The no-oracle fallback supplies a complete ordinary denial. Failure evidence distinguishes `authority_check_failed_closed` from a normal evaluation. The two current authority producers supply the required shape. [Pipeline][pipeline] and [focused tests][focused-tests]

### Independent focused proof

| Proof | Result |
| --- | --- |
| Original focused suite and original configuration | 27/27 passed; zero pending/skipped |
| Original packet negative-control runner and manifest | 8/8 LIVE; zero vacuous |
| Clean baseline within the mutation runner | 27/27 passed |
| Direct historical fail-open mutation | The named assertion failed because the executor spy was called once |
| Source restoration | All tracked mutations restored; both review and disposable source checkouts verified clean |

The independent local runtime used Node 24.19.0, Vitest 2.1.9 and TypeScript 5.9.3 with explicit direct dependency versions selected from the repository lockfile and installed through isolated npm; transitive resolution was not the frozen pnpm dependency tree. The runtime also differs from the repository's Node 20.18.1. No assertions, original configuration, manifest or runner semantics were weakened. Shared/DB prerequisite packages compiled and the unchanged Prisma schema generated successfully. Full local application CI was not repeated. See [PR #155 reproduction and results](pr155/README.md).

### Exact-head CI evidence and its limits

All five required workflows completed successfully at the current head. All returned collections were inspected: six runs including the extra push divergence run, 20 jobs and 23 check runs. The test checkout `002b44f09f5ec238cb5cb0a7c1e06648f551cdc2` and PR head `a597c692` have the same tree, `f6eda347f98a6f46bc6e842e9b579502c6d33059`. [CI evidence](authority/pr155-ci-evidence.json)

| Workflow or inspected log | Supported conclusion |
| --- | --- |
| [CI/CD Pipeline 38162875348][ci] | 4,428 server tests and 210 web tests passed; K12 reported 16 required/discovered cases satisfied at declared scope. |
| [Agent Control Gate 38162875351][control-ci] | Artifact checks passed. The non-draft admission step was **skipped** because the PR is draft. |
| [Branch divergence 38162875391][divergence-ci] | Applicable PR check passed. |
| [DAST 38162875383][dast-ci] | Workflow guard passed, but scan setup and HawkScan were **skipped** because no HawkScan key was configured. No dynamic scan occurred. |
| [Worker Proof 38162875434][worker-ci] | Windows 515/516 and Ubuntu 491/492; zero failed and one named authenticated-gh/PowerShell cursor skip per platform. 193/193 control-plane mutation controls were live in the Windows log. |

The application packet's eight controls were established by the independent local run, not inferred from the 193 control-plane controls. Lint and Security Scan jobs reported success, but their detailed security findings were not audited here. No vulnerability-free conclusion follows.

The exact-head [Copilot review][copilot] reports quota exhaustion. Its outcome is **NOT_RUN / quota_exhausted**, not PASS. This fresh ChatGPT evidence supplies a narrow technical review; the required formal review/admission transport remains a separate step.

### Residual boundaries that the PASS does not cover

**Request-wide effects.** After the parsed batch fails, other model-tool or text-action paths remain reachable. The text-action fallback and streaming path are separately guarded by existing action/executor authority checks, but the first batch failure is not propagated as a request-wide prohibition. The informational-response fixture proves its specific case, not arbitrary model output. [Pipeline][pipeline], [actions][actions], [executor][executor]

**Existing executor integration mismatch.** The real `executeBatch` returns a `BatchResult` with `.results`; the pipeline calls `.map` on the returned value, while the focused test mocks an array. This predates the patch. The allowed-path test proves arrival at the executor boundary, not successful real result processing. The mismatch can enter the existing error/fallback path and warrants separately scoped correction. [Executor][executor] and [focused tests][focused-tests]

**Cross-field policy.** A structurally valid `supervised` verdict with `requiresApproval: false` preserves existing executable behavior. Current producers require approval for supervised results. Changing that policy is outside this patch's declared boundary.

These limitations remain explicit. They are not silently added to PR #155 and are not erased by its narrow PASS.

## 5. The shipped Flow path has separate unresolved authority defects

The web chat hook posts to `/ai/businesses/:businessId/flow/chat/stream`, entering `AiFlowController` and `FlowOrchestratorService.streamChat`. It does not enter the parsed-command function changed by #155. The actual Flow source therefore requires its own evidence. [Web caller][web-caller] and [controller][controller]

### Primary policy read failure can promote permissive legacy settings

`AiOversightService.getAutonomySettings` prefers typed `AutopilotSettings`. If that read throws it records `readFailed`, but a parseable legacy `AiMemory` result returns immediately before the degraded/restricted branch. No freshness or authority-equivalence proof accompanies this promotion. [Oversight][oversight]

The real policy code, with synthetic database responses, produced:

| Typed policy read | Legacy policy | Decision |
| --- | --- | --- |
| Successful, advisory | Permissive | Deny |
| **Throws** | **Permissive** | **Allow, no degraded marker** |
| Throws | Throws | Deny, degraded |
| Successfully observed absent row | Permissive | Allow under supported legacy behavior |
| Throws | Malformed JSON | Deny, degraded |

This is a conditional fail-open downgrade, not a claim that every database outage allows execution. It needs a selectively unavailable typed read and a readable permissive legacy value. No production policy divergence, caller-induced read failure or actual action was established. The source also shows that the missing degraded marker defeats the intended guard on a legacy-policy read-modify-write in this state; that write was not exercised.

The correction belongs to the existing policy-resolution owner and its fail-closed tests. Keep confirmed absence distinct from read failure; preserve legitimate legacy operation when authoritative absence is known. If a deliberate failure fallback is required, specify and verify its authority/provenance contract. The existing tests make both reads fail together and omit the selective-failure case. [Existing fail-closed tests][oversight-tests]

### Client-supplied job-role authority: existing finding, fresh CRM effect trace

The repository [capability map][capability-map] already records that inline `pageContext` lets the public client supply a `jobRoleEnvelope` and bypass the crew-role check. This review confirms that the defect remains at current main and traces a concrete mutating capability. Retain that existing finding identity; do not create a duplicate just because the evidence is newer.

Both authenticated Flow chat routes forward the caller's page context. `BusinessGuard` establishes access to the business, including membership, not the supplied job-role grant. Tool selection uses the claimed envelope instead of the crew menu. Governance similarly checks the envelope and bypasses the no-granting-crew denial. `JobRolePolicyService` evaluates the supplied values without resolving the claimed assignment from trusted storage. [Controller][controller], [business guard][business-guard], [Flow orchestrator][flow], [job-role policy][job-policy]

Using real role/policy code and the exact tool-selection method, the synthetic probe showed that `crm_delete_contact` is unavailable to every built-in role, yet an invented role envelope with wildcard tools and a high tier makes it selectable and allowed without confirmation under a sufficiently permissive business policy. The business blocklist and advisory mode still deny it.

The source-verified effect path extends beyond tool visibility: `governToolCall` returns the legacy verdict for capabilities not adopted by the action boundary, whose sole adopted capability is `helpdesk_create_ticket`. The CRM adapter calls `softDeleteContact` without `actorUserId`; CRM's per-user delete check runs only when that argument exists. The subsequent operation is a within-business **soft delete**, subject to the contact/business lookup. [Action adoption][action-envelope], [Flow adapter][flow], [CRM enforcement][crm]

This establishes an authenticated, conditional within-business authority bypass in source and policy decisions. It does not establish unauthenticated or cross-tenant access, permanent hard deletion, bypass of all business policy, or a production exploit. No HTTP/LLM/delete integration was run and no contact was changed. A real effect additionally needs a functioning model/tool path, an allowed business policy and valid arguments.

Correct the public trust boundary through existing Flow ingress and authorization owners: public display/context data cannot confer authority; server-derived assignment authority must remain separate. A DTO must actually reject or strip nested authority fields. Preserve the legitimate staff bridge, which derives its envelope on the server. Carrying the verified actor to domain enforcement is a contributing defense obligation. Expanding ACTION-001 capability adoption is a separate release and is unnecessary to correct this ingress defect. [Staff bridge][staff-bridge]

See [Flow evidence and reproduction](flow/README.md), including the independent source validation.

## 6. Handoff and completion limits

The immediate deliverables are this repository evidence package, a PR #155 review-evidence comment, and a non-authority #80 PROGRESS whose exact body is checked against the live selector before publication. The current H1 assignment remains selected. No active-packet file, return artifact, checkpoint, programme DAG, workflow, merge grant or production configuration is changed by this work.

At the next safe handoff, the existing authority owner should re-resolve main/PR/H1 state, formally disposition the obsolete reanchor instruction, and carry the fresh narrow PR #155 review through the existing semantic-review/admission contract. F9 then needs a separately issued bounded implementation directive using the correction contract above. The two Flow findings and pre-existing executor mismatch remain explicit follow-on obligations in their current owners, not unannounced additions to #155.

**Programme completion credit: zero.** This review produces evidence and a narrow technical verdict. It does not prove implementation completion, admission, merge, post-merge operation or whole-application safety.

## Evidence integrity

[MANIFEST.json](MANIFEST.json) lists the files in this package with SHA-256 hashes. Source hashes are recorded with the relevant probes. The complete public issue history was collected for replay but is not duplicated in this package; collection metadata, replay results, applied effect identities and recovery instructions preserve the evidence basis. A future collection can differ if comments are added, edited or removed, so reproduce the current state as a new dated observation rather than silently relabelling it as this snapshot.

[execution-standard]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/docs/development/EXECUTION_CONTROL_STANDARD.md
[action-resume]: https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-5998716917
[old-review]: https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6023054785
[old-contradiction]: https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6023151885
[h1-directive]: https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6229570731
[p0-progress]: https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6230334535
[routing-authority]: https://github.com/SaCH-PRO/KEYFLOWOS/issues/80#issuecomment-6229439023
[selector]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/scripts/agent-control/select-directive.mjs
[parser]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/scripts/agent-control/lib/control-envelope.mjs
[f9-record]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/.agent-control/claude-return.yaml#L676-L688
[admission]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/scripts/agent-control/lib/admission.mjs#L138-L175
[gate]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/.github/workflows/agent-control-gate.yml#L102-L126
[merge-runner]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/scripts/agent-control/auto-merge-admitted.mjs
[autopilot]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/.github/workflows/agent-control-autopilot.yml
[authority-effects]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/scripts/agent-control/lib/authority-effects.mjs#L298-L332
[pr155]: https://github.com/SaCH-PRO/KEYFLOWOS/pull/155
[pipeline]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/a597c692fcb102de558dd832d88738c0402f69a2/apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts
[focused-tests]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/a597c692fcb102de558dd832d88738c0402f69a2/apps/server/src/modules/key-cortex/__tests__/key-cortex-query-pipeline.service.spec.ts
[actions]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/a597c692fcb102de558dd832d88738c0402f69a2/apps/server/src/modules/key-cortex/key-cortex-actions.service.ts
[executor]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/a597c692fcb102de558dd832d88738c0402f69a2/apps/server/src/modules/key-cortex/key-cortex-executor.service.ts
[ci]: https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/38162875348
[control-ci]: https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/38162875351
[divergence-ci]: https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/38162875391
[dast-ci]: https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/38162875383
[worker-ci]: https://github.com/SaCH-PRO/KEYFLOWOS/actions/runs/38162875434
[copilot]: https://github.com/SaCH-PRO/KEYFLOWOS/pull/155#pullrequestreview-5484373795
[web-caller]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/apps/web/src/components/key/chat/use-key-stream.ts#L113
[controller]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/apps/server/src/modules/ai/flow.controller.ts#L17-L80
[oversight]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/apps/server/src/modules/ai/ai-oversight.service.ts#L326-L392
[oversight-tests]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/apps/server/src/modules/ai/ai-oversight-fails-closed.spec.ts
[capability-map]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/docs/CAPABILITY_MAP_2026-08-09.md#L113
[business-guard]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/apps/server/src/core/auth/business.guard.ts#L19-L45
[flow]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/apps/server/src/modules/ai/flow-orchestrator.service.ts
[job-policy]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/apps/server/src/modules/structure/job-role-policy.service.ts
[action-envelope]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/apps/server/src/modules/key-autonomy/action-boundary/action-envelope.ts#L27
[crm]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/apps/server/src/modules/crm/crm.service.ts#L837-L861
[staff-bridge]: https://github.com/SaCH-PRO/KEYFLOWOS/blob/98ee0202499ba87fa4ee13d58a2a9075016225bd/apps/server/src/modules/structure/staff-chat-bridge.service.ts#L102-L127

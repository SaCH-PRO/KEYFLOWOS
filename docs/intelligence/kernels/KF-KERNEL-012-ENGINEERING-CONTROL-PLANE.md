# KF-KERNEL-012 - Engineering Control Plane

Checkpoint: `J24-SCCR-2026-09-16-01`  
Status: **PROVISIONALLY TARGET-ALIGNED - NAMED SAFE-CHANGE CORE; ENFORCEMENT NOT PROVEN**  
Implementation baseline: `8f173bfe79f1418159cf4099ea18b0d60d203ec2`  
Production implementation authorized: **NO**.

This materializes the existing K12 identity in 12-KERNEL-PROGRAMME.md. It is not a new kernel or parallel constitution. [J24 safe-change review](../investigations/J24-SAFE-CHANGE-CONVERGENCE-REVIEW.md) is the evidence/acceptance home; [PA](../investigations/J24-PROOF-ADMISSION-AND-RUN-ISOLATION-MAP.md) and its unchanged YAML own the detailed admission design. Source/settings facts must retain their individual baselines and dates.

## A. Definition / Scope

Own the semantics for changing KEYFLOWOS safely: accepted architecture and policy, implementation packets, source/build identity, isolated verification, proof admission, independent review, migration/release prerequisites, withdrawal, generated-document provenance and return of results to the shared model. Not a new application executor, test framework, role system or CI product.

## B. Product Intent

Optional behavior can be added, compared, disabled, replaced and removed in controlled environments without breaking one coherent user-facing business flow. Safety invariants and historical truth remain load-bearing; external actions are not assumed reversible merely because code can be reverted.

## C. Truth Ownership

```text
accepted policy != candidate proposal
source/build identity != branch name
test source != executed test != accepted proof
accepted proof != merge authorization != release authorization
code rollback != external reversal
map snapshot != current canonical analytical state
halt obeyed != application tests passed
```

CURRENT-STATE.yaml owns current programme state. Generated maps remain projections. The user's pause on map refresh is explicit; do not regenerate them while paused.

## D. Current Implementation / Control Sources

Existing OS constitution and playbooks; GitHub branch/ruleset metadata; root CODEOWNERS and PR template; pinned CI/package/Turbo/Vitest configuration; boot and fixture setup; existing GrowthBook exposure; canonical 11/12/13 protocols. Exact scopes/blobs are in J24 review and PA.

Live main's owner halt on scheduled cycles is newer operational control, not a reason to change the forensic code baseline. Accessible main summary reports protection off and the returned ruleset is disabled; detailed classic protection is inaccessible. No universal control-plane safety claim follows.

## E. Inputs

Accepted policy P; exact candidate H/target B/tested composition M; current human/agent permission; invariants/case selection; intended data/API/event changes; resource/effect scope; installed toolchain/build identity; run observations; existing migration and provider uncertainty.

## F. Outputs / Consumers

A rejected, incomplete or satisfied-at-declared-scope proof decision; exact review/integration request; release prerequisites; withdrawal/residual cleanup record; validated return packet; affected journey/kernel reopen links. These are semantic outputs, not implemented new database entities.

## G. State / Transition Semantics

```text
PROPOSED -> SCOPE/POLICY ACCEPTED -> RUN ADMITTED -> EVIDENCE COLLECTED
 -> PROOF REVIEWED -> INTEGRATION AUTHORIZED -> RELEASE SEPARATELY AUTHORIZED
 -> OBSERVED / RECONCILED -> SHARED MODEL UPDATED
```

Any stage can reject or remain incomplete. Run cancellation, missing evidence, skipped tests and cleanup uncertainty are not promoted by an ordinary green exit. Revisions invalidate only evidence/approval whose assumptions changed, under a reviewed reuse policy; do not erase prior attempts.

## H. Journey Impact Matrix

Anchor J24; direct pressure from J13/J18/J23/J2/J15. Applies to all eventual implementation packets, including the next J8 commitment-to-delivery investigation. No claim to have freshly audited every journey's source.

## I. Canonical Vocabulary / Contracts

Reuse exact source/attempt/effect/control/evidence vocabulary from existing kernels. P/H/B/M and SC labels are document-local notation, not new KF-CONCEPT allocations. Detailed proof receipt and case definitions remain in PA/J13 rather than duplicated here.

## J. Authority / Governance

Current owner restrictions and explicit scope outrank stale snapshot permission. Scheduled truth/audit/burndown/reflect cycles remain halted. Accepted rules are independently versioned; a candidate cannot lower its own acceptance requirements. The existing human-reviewed implementation protocol governs code integration. Agent review is useful evidence, not automatic permission to merge its own work or deploy.

## K. Transactions / Concurrency / Identity

Bind proof to exact composition, policy, case set, resource owner and attempt. Compare identities, not aggregate counts alone. Parallel worktrees do not isolate databases/queues/ports. Target changes, cancelled shards, stale approvals and prior attempts stay explicit. Preserve single real effect ownership when switching variants; current revocation still applies.

## L. Failure / Recovery

Reject/incomplete on wrong policy, unbound or missing cases, skips/setup errors, incorrect source/composition, forged/untrusted publisher, wrong resources or unsupported freshness. Preserve partial observations and unresolved child/resource cleanup. Rollback to a proved compatible control/artifact only; otherwise stop promotion and repair forward. Never remove a gate just to unblock a failing candidate.

## M. Security / Privacy

Keep candidate execution separate from privileged policy/evaluation/publication. Restrict credentials, resource capabilities and network destinations before candidate configuration/module evaluation. Treat reports/artifacts as untrusted bounded data, not executable helpers. Hashes establish correspondence, not truth. No secret values in intelligence or public proof summaries.

## N. Evidence / Observability

Record source/build/policy, exact command/config/seed, accepted versus discovered identities, per-case outcomes, suite/setup/cancellation data, fresh/reused provenance, independent review and cleanup. Report boot stages separately: artifact, child startup, HTTP identity, declared readiness and confirmed closure. Preserve the existing useful tests and negative controls.

## O. Reachability / Consumers

Existing CI/test/PR/playbook paths are named and traced, not globally exhaustive. Active hosting settings, bypass permissions, installed report behavior, concrete resource allocator/evaluator and all deployment paths remain conformance work. Do not claim this dossier implements any of them.

## P. Duplication / Legacy / Compatibility

Strengthen existing GitHub/Vitest/build/provisioning/handoff seams. A new metadata file or collector that no real promotion path consumes is not enforcement. Preserve useful historical evidence and compatibility; no second status authority or universal runtime selected.

## Q. Invariants

1. Current permission is checked separately from historical forensic truth.
2. The candidate does not select or weaken the accepted rules used to judge it.
3. Test identity, scope and resource provenance survive evaluation and reuse.
4. Missing/skipped/incomplete required proof cannot be equivalent to acceptance.
5. Evidence acceptance does not authorize merge, release or business action.
6. Candidate code cannot control privileged evaluation/publication by editing its checkout.
7. One business effect retains one owner across experimental variants.
8. Withdrawal preserves revocation, history, compatibility floor and uncertainty.
9. A requested pause on derived-map updates remains in force until lifted by the user.

## R. Findings / S. Contradictions

No new F/C/REC IDs allocated. J24 local observations and live-control gaps are evidence in its reviews, not silently numbered findings. They refine engineering proof/authority composition and must pass canonical anti-duplication before any future allocation.

## T. Open Questions

CS1-CS5 in the J24 review: actual hosting enforcement, trusted evaluator isolation, executable case/resource proof, integration/release compatibility and operational control freshness. Existing ED1-ED5 remain. The available protection summary is off; uncertainty is about additional inaccessible detail, not whether that returned field was false.

## U. Target-State Candidate

Accepted P + exact H/B/M -> restricted run controller -> isolated candidate -> observed evidence -> trusted evaluator -> independent human integration decision -> separately authorized release -> retained outcomes -> shared architectural model. Detailed SC01-SC09 and source/limits remain in J24 review.

## V. Migration / Compatibility

Adopt independently accepted policy and case selection; establish resource isolation; collect/evaluate native reports; separately authorize reliable required-check/review enforcement; only then admit proved integration/release scope. Pause unsafe promotion on failure. No code/settings changes are authorized by this ordering.

## W. Proof / Test Ratchets

Retain J13's 44 unexecuted case obligations and PA's analytical challenges. Validate wrong-policy, spoofed publisher, missing/skip/shard, changed composition, unsafe report parsing, stale-control and rollback scenarios in future authorized tests. These are not new executed tests or new runner bindings. Map tooling checks do not count as app proof.

## X. Layered Improvement

Mapped source/control discrepancies -> coherent cross-kernel trust/admission design -> enforced isolated verification and independent integration -> safe adaptable system evolution. This checkpoint reaches bounded target alignment, not enforcement or operational proof.

## Y. Machine-readable Record

```yaml
id: KF-KERNEL-012
name: Engineering Control Plane
checkpoint_id: J24-SCCR-2026-09-16-01
status: PROVISIONALLY_TARGET_ALIGNED_NAMED_SAFE_CHANGE_CORE_ONLY
anchor_journey: J24
acceptance_home: docs/intelligence/investigations/J24-SAFE-CHANGE-CONVERGENCE-REVIEW.md
implementation_authorized: false
runtime_proof_executed: false
scheduled_cycles_status: HALTED_OWNER_CONTROL_PRESERVED
programme_map_refresh: PAUSED_UNTIL_EXPLICIT_USER_REQUEST
```

# KEYFLOWOS — GenAI Convergence Validation & Implementation Packet Derivation

Status: VALIDATION PASS 1 COMPLETE / PACKET DERIVATION COMPLETE / IMPLEMENTATION NOT RELEASED
Date: 2026-10-06
Validated live main observed: 6fdffc26c7c7748d5c09900535c97c197864ab54
Parent R&D ledger: issue #153
Global synthesis: docs/intelligence/research/GENAI-RD-GLOBAL-CONVERGENCE.md

## 1. Validation result

The global cross-layer convergence remains structurally valid against current live main.

Canonical spine:
Constitution / Authority
-> Context Genome
-> Cognitive Function
-> Plan / Procedure
-> Capability Contract
-> Authority + Guardrails
-> Effect Execution
-> Evidence / Outcome
-> Assurance / Evaluation
-> Governed Learning / Promotion

The first implementation packet should be the autonomy fail-closed correction, but it must remain READY-BUT-HELD until the current ACTION-001 control-room packet is admitted/checkpointed, or until per-packet dispatch issue #110 is actually live.

The reason is control-plane safety, not file overlap.

## 2. Live-main validation anchors

### Execution / capability

Validated:
- ADR-0001 still declares Flow the single execution substrate and Cortex proposal/advisory only.
- FLOW_TOOLS remains the canonical tool registry.
- CapabilityContractService projects FLOW_TOOLS into a platform capability contract.
- active PR #147 (KF-EXEC-ACTION-001) is implementing the Capability -> Control -> Clearance boundary for helpdesk_create_ticket.
- PR #147 is open/draft at head de47dd526b416a98418bb6337f12a1fc02e6e444 and is based on live main 6fdffc26.
- Its changed files heavily overlap capability, Flow, key-autonomy and execution/evidence infrastructure.

Ruling:
candidate packets that touch capability/effect/idempotency/compensation must not be released concurrently against the same base.

### Authority / autonomy

Validated:
- AutonomyOrchestratorService exists and is broadly wired.
- the live Cortex query pipeline still contains the warning text: Autonomy check failed, using all parsed commands.
- an exception in the autonomy decision path can therefore leave the original parsed command set executable.

This directly violates the canonical invariant:
authority uncertainty/error may only narrow capability, never widen it.

This is the highest-severity repository finding from the global R&D convergence.

### Memory / Context Genome

Validated:
- UnifiedMemoryRetrievalService is live and has multiple consumers.
- issue #106 remains the parent Context Genome architecture.
- issue #122 remains the memory causal-truth audit.
- issue #123 is already the exact M1 contract owner for ContextScope/Kind, authority vs confidence vs verification, valid time vs recorded time, provenance, supersession and cross-scope denial.
- issue #124 already owns additive shadow persistence after M1.
- PR #112 is an older Context Genome foundation branch and must be reconciled, not treated as a new independent truth.
- PR #127 is the current memory-truth static proof baseline.
- PR #148 is a planning/convergence document, not canonical runtime authority.

Ruling:
do not create another Context Genome issue/service/store. Candidate D maps directly to #123.

### CognitiveFunction / structured output

Validated:
- ModelGatewayService remains the provider-routing owner.
- GatewayRequest.responseFormat exists.
- current provider dispatch still does not justify claiming end-to-end native structured-output enforcement from that field alone.
- ai-output-contracts.ts still owns hand-written post-hoc validation.

Ruling:
structured-output honesty is a bounded ModelGateway/CognitiveFunction convergence task, not a new prompt framework.

### Evaluation / observability

Validated:
- EvalHarnessService exists.
- memory-retrieval-precision still checks returned-list/rank-score properties rather than relevance precision.
- explanation-quality still accepts an empty rule trace because length >= 0.
- Langfuse integration still posts to /api/public/ingestion.
- no canonical OTel/OpenInference runtime spine was recovered from current main.

Ruling:
issues #130 and #151 remain the correct owners for evaluation/proof semantics.
Issue #42 is historical stack rationale; #130 is the stronger current programme owner.

### Guardrails / privacy

Validated:
- current KeyCortex checks remain heuristic/basic rather than a complete GuardrailPolicy lifecycle.
- centralized deepRedact() exists for structured secret-bearing fields.
- content-aware free-text PII/secret recognition is still incomplete.
- no evidence invalidates the Layer-10 trust-boundary convergence.

### Effect safety

Validated:
- SafetyShellService.check() is wired in current execution code.
- old backlog statements saying it still needs to be wired are stale.
- SafetyShellService still contains a process-local Set<string> idempotency cache.
- durable distributed idempotency remains a real future requirement.

## 3. Stale / contradictory architecture claims found

### STALE-01 — old Mind/Soul master plan baseline

docs/KEY_MIND_SOUL_EVOLUTION_MASTER_PLAN.md contains historical baseline statements such as no unified memory retrieval, no eval harness, and SafetyShell as a future deliverable.

Current main has UnifiedMemoryRetrievalService, EvalHarnessService and wired SafetyShellService.check().

Disposition:
treat the June plan as historical planning evidence, not current-state authority.

### STALE-02 — audit backlog SafetyShell wiring item

docs/audits/KEY_AUDIT_BACKLOG.md still carries a P0 item to wire SafetyShellService.check().

Current main shows that wiring exists.

Disposition:
mark stale/resolved-by-later-code when the backlog is next reconciled; do not re-implement.

### STALE-03 — tool-count drift

Repository documents report different historical counts for FLOW_TOOLS/capabilities.

Disposition:
tool counts are generated/revision-bound observations, not architecture law. Use exact-head generated inventory.

### STALE-04 — R&D issue body progress

Issue #153 original body still shows early Layer-1 progress text, while comments + master continuation contain the completed state.

Disposition:
comments + master continuation remain current R&D state.

## 4. Candidate implementation packet ownership map

A. autonomy fail-closed
Owner: AutonomyOrchestrator + Cortex query boundary; control authority #80; historical foundation #41.
Dependency: ACTION-001 active; no direct file overlap if surgical, but #110 per-packet dispatch is not live.
Validation: READY-BUT-HELD; FIRST PACKET.

B. OTel / Langfuse compatibility
Owner: #130 Assurance + #151 eval semantics; historical #42 observability.
Dependency: avoid competing with active PR #133 semantics; deadline 2026-11-16.
Validation: READY FOR DERIVATION after A sequencing.

C. CognitiveFunction / structured-output honesty
Owner: ModelGateway + Layer-7 contracts; #153 R&D parent.
Dependency: no dedicated implementation issue; must be bounded.
Validation: DERIVE after A/B ownership slot.

D. Context Genome M1
Owner: #106 parent, #122 M0, #123 M1, #124 M2.
Dependency: PR #112/#127/#148 already occupy related memory work.
Validation: DO NOT CREATE NEW OWNER.

E. capability/effect/account hardening
Owner: FLOW_TOOLS / CapabilityContract / ACTION-001; connector architecture.
Dependency: strong overlap with PR #147.
Validation: HOLD.

F. evaluation/proof foundation
Owner: #130 + #151.
Dependency: PR #133 active; converge, do not duplicate.
Validation: MAP TO EXISTING.

G. context/tool trust-boundary admission
Owner: Layer-10 convergence; #131 for external learning intake; Capability Fabric for tools.
Dependency: no single runtime owner yet; depends on Context Genome + Capability semantics.
Validation: LATER.

H. durable idempotency / compensation / outcome
Owner: ACTION-001 / key-autonomy / SafetyShell / domain evidence.
Dependency: strong overlap with PR #147.
Validation: HOLD until ACTION-001 settles.

## 5. Control-plane sequencing constraint

Issue #110 per-packet authority queue remains queued rather than proven live.

Therefore:
- unrelated implementation packets cannot be assumed safe to release in parallel merely because file write-sets do not overlap;
- a new #80 DIRECTIVE can still create dispatch/ownership ambiguity under the historical global-authority flow;
- this pass derives the next packet but does not release it while KF-EXEC-ACTION-001 is still in the active admission path.

## 6. Smallest safe first implementation packet

Packet ID: KF-EXEC-AUTH-FAIL-CLOSED-001
State: DERIVED / READY-BUT-HELD / NOT RELEASED

Why first:
- safety severity: CRITICAL;
- architectural leverage: HIGH;
- dependency centrality: HIGH;
- blast radius: VERY LOW if surgical;
- proofability: HIGH and deterministic.

### Intended scope

Primary semantic file:
- apps/server/src/modules/key-cortex/key-cortex-query-pipeline.service.ts

Tests:
- existing query-pipeline/autonomy tests under apps/server/src/modules/key-cortex/__tests__/
- only the minimum negative-control/proof fixture required by the established proof system if released.

Explicitly out of scope:
- schema migration;
- new service;
- provider calls;
- new dependency;
- UI;
- Context Genome changes;
- FLOW_TOOLS/CapabilityContract changes;
- broad guardrail refactor;
- AutonomyOrchestrator redesign.

### Required behavior

When parsed executable commands require autonomy evaluation and that evaluation throws, is unusable or is unavailable in an action-capable path:
- executable command set becomes empty/non-executable;
- the system may continue an informational response;
- it may request confirmation/approval only through an existing trusted mechanism;
- it must not execute the original parsed command set;
- it must record the degradation/failure honestly.

Hard invariant:
authority_check_error => executable capability set after error is a strict subset of or equal-safe subset of the set before the error, never wider.
For this parsed-command path, the safe default is zero executable commands.

### Required proof

AUTH-FC-P01 — exception narrows:
parsed commands exist; autonomy evaluator throws; no command executes.

AUTH-FC-P02 — no fake fallback:
restoring the historical using-all-parsed-commands behavior causes proof failure.

AUTH-FC-P03 — conversation survives:
a non-effect informational response can still be produced.

AUTH-FC-P04 — allowed path unchanged:
an allowed command retains existing successful behavior.

AUTH-FC-P05 — denied path unchanged:
a denied command remains non-executable.

AUTH-FC-P06 — honest observability:
failure is recorded as authority-check failure, not authorization success.

Negative control:
restore the old fail-open catch behavior. The named test must fail for the intended reason. A test that survives this mutation is vacuous.

### Stop conditions

Stop rather than widen scope if:
- current main no longer contains the fail-open branch at release time;
- PR #147 or another admitted packet has modified the same semantic path;
- a fix requires redesigning AutonomyOrchestratorService;
- a fix requires new database schema;
- another canonical owner has already corrected the invariant;
- control-plane authority cannot bind the packet to current main exactly.

### Release gate

Before posting a #80 DIRECTIVE:
1. ACTION-001 is admitted/checkpointed OR #110 per-packet dispatch is proven live;
2. re-read current main;
3. re-characterize the exact catch branch;
4. bind exact source_main/source_head;
5. verify write-set conflicts;
6. compile proof obligations into the packet contract.

## 7. Second packet recommendation

After packet A release/settlement, next highest priority:
KF-ASSURANCE-OTEL-LANGFUSE-COMPAT-001

Owner:
- #130 Assurance Fabric;
- #151 evaluation/trace semantics;
- issue #42 only as historical rationale.

Reason:
- 2026-11-16 legacy-ingestion deadline is time-bounded;
- OTel/OpenInference is the converged vendor-neutral direction;
- correct packet is compatibility/telemetry foundation, not a Langfuse-specific rewrite.

## 8. Memory packet ruling

Do not create a new Context Genome contract packet.

Use:
- #122 M0 evidence;
- #123 M1 contract;
- #124 shadow persistence.

PR #112 must be reconciled into that lineage or explicitly retired/superseded.

## 9. Assurance packet ruling

Do not create a new universal eval system.

Use:
- #130 Assurance Fabric;
- #151 harness/eval convergence;
- PR #133 as current proof-obligation compiler work.

## 10. Capability / connector packet ruling

Do not broaden ACTION-001 while PR #147 is open.

PR #147 is already proving the first real Capability -> Control -> Clearance chain.
Global capability/effect/account convergence should consume its admitted result rather than compete with it.

ConnectorRegistry vs KeyConnector convergence remains real, but is a separate bounded follow-on after the action contract stabilizes.

## 11. Updated frontier

Research is closed.

Current programme frontier:
WAIT FOR CONTROL-PLANE RELEASE SLOT, then release KF-EXEC-AUTH-FAIL-CLOSED-001 as the smallest first implementation packet.

Read-only derivation may continue for OTel/Langfuse and owner maps, but no new application mutation should be released in a way that shadows ACTION-001.

No implementation is authorized by this document.

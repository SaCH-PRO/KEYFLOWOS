# Reconciliation: garrytan/gstack -> KEYFLOWOS

**Reconciliation ID:** REC-EXT-GITHUB-GARRYTAN-GSTACK-002
**Source:** EXT-GITHUB-GARRYTAN-GSTACK-002
**Pinned source revision:** `f67c478f05d8e0b39339599ad11c91a3478515ae`
**KEYFLOWOS baseline inspected:** `main@ac3a6384417093f198bcc7d672b0dbc295db137c`
**Date:** 2026-10-07
**Status:** RECONCILED / IMPLEMENTATION_CANDIDATES_IDENTIFIED
**Authority:** intelligence evidence only; this file does not authorize production changes.

## Executive result

The gstack mining run is useful primarily because it provides independent implementation evidence for several directions KEYFLOWOS already contains in partial form:

- specialist capability/reviewer separation;
- fail-closed control and proof;
- bounded worker execution;
- persistent learning/context;
- human decision gates;
- evidence-producing QA.

The main value is therefore **convergence and hardening**, not importing a new framework.

The strongest gap exposed by the comparison is:

> KEYFLOWOS has strong *declared* packet scope, worktree isolation and admission proof, but it does not yet have a general machine-enforced mutation boundary that turns a packet's allowed scope into least-authority write capabilities across every mutation channel.

The second strongest gap is:

> KEYFLOWOS worker state largely distinguishes lock/process existence and task state, but not a canonical ALIVE / RESPONSIVE / HEALTHY / BUSY / STALE / VERSION_MISMATCH state algebra.

The third is:

> KEYFLOWOS has learning, memory, capability and ingestion components, but important parts are dormant or only partially wired, so development outcomes do not yet close a reliable merge/incident/review -> durable learning -> future-task-context loop.

## Evidence anchors in current KEYFLOWOS

### Existing strengths

1. **Independent semantic review already exists and fails closed.**
   `docs/development/AGENT_CONTROL_PLANE.md` requires independent review of the exact admitted semantics. The implementer cannot self-review; stale/wrong-head evidence, unresolved findings and missing evidence block admission.

2. **No-fake-green has executable negative controls.**
   `scripts/agent-control/negative-controls.yaml` mutation-tests exact-head admission, review-required admission, fail-closed state transitions, bounded correction, contradiction blocking, worker completion markers, authority parsing and worktree isolation.

3. **Worker isolation and bounded retry are implemented.**
   `scripts/agent-control/claude-worker.ps1` uses a dedicated worktree, an exclusive worker lock, durable cursor/attempt state, bounded identical retries and HELD_RETRYABLE escalation.

4. **Scope is explicit in control artifacts.**
   `AGENT_CONTROL_PLANE.md` assigns ChatGPT ownership of allowed/prohibited scope, while `.agent-control/active-packet.yaml` carries packet-specific `allowed_scope`.

5. **KEY already has capability and learning owners.**
   `KeyCortexCapabilityRegistryService`, `KeyCortexLearningService`, `MemoryConsolidationService` and `KnowledgeIngestionService` exist. These are candidate owners to evolve rather than replace.

### Existing weaknesses relevant to gstack

1. `KnowledgeIngestionService` is explicitly marked dormant and has no injector. The system-map and audit backlog both say external knowledge ingestion is not live.
2. The current capability registry is large and lacks direct specs naming it according to the system map, so it is not yet a safe basis for adding more orchestration semantics without characterization.
3. KEY's learning loop is assessed as partial; live outcome/feedback wiring is incomplete.
4. Worker stale-lock handling is primarily process-liveness based. A live-but-unresponsive worker is not represented as a distinct canonical state.
5. Packet scope is structurally represented, but there is no general repository-level mutation guard proving that every write path stayed inside the semantic/file/resource capability boundary.
6. Browser/E2E evidence is not yet a canonical admission artifact class comparable to exact-head CI and semantic review.

## Finding-by-finding reconciliation

| gstack finding | KEYFLOWOS disposition | Current reality | Action |
|---|---|---|---|
| F1 Specialist roles | **PARTIAL / IMPROVEMENT** | KEY has capability registries and some multi-expert prompting; development admission has an independent semantic reviewer, but not a canonical reviewer-lens model. | Represent review lenses as evaluator/capability profiles attached to one task. Do not create permanent agent silos. |
| F2 Staged review pipeline | **PARTIAL / IMPROVEMENT** | Exact-head independent semantic review is strong, but it is one semantic gate rather than architecture/security/business-logic/UX lenses with reconciled dispositions. | Add bounded reviewer-lens composition inside the existing proof/control plane. |
| F3 Durable project learning | **PARTIAL / MISSING WIRING** | Learning, memory consolidation and ingestion services exist; audits state key loops are partial or dormant. | Feed accepted review findings, incidents, corrections and post-merge outcomes into existing memory/intelligence owners with provenance. |
| F4 Recurring retrospectives | **MISSING_CAPABILITY / IMPROVEMENT** | No canonical engineering-retro ingestion loop was found. | Add a development-retro trigger to the Continuous Intelligence Loop, not a separate retro database. |
| F5 Context checkpoint lineage | **PARTIAL / IMPROVEMENT** | Durable packet/RETURN/control history and dedicated worktrees exist. Cross-session development checkpoint lineage across branches/worktrees is not a canonical resolver. | Define checkpoint identity, supersession and newest-valid resolution using repository truth. |
| F6 Executable safety hooks | **PARTIAL / HIGH-VALUE IMPROVEMENT** | Admission and negative controls are executable, but allowed/prohibited work scope is still primarily contract + post-hoc validation. | Convert packet authority into pre-mutation capability checks where feasible. |
| F7 Narrow edit boundaries | **MISSING_CAPABILITY / HIGH PRIORITY** | Worktree isolation prevents shared-checkout collisions, but does not prove each mutation is inside packet scope. | Build a mutation-authorization seam that covers Edit/Write, shell/file operations, GitHub mutations, DB/schema actions and provider effects according to capability. |
| F8 Browser QA evidence | **PARTIAL / IMPROVEMENT** | CI/proof evidence is strong; browser screenshots/action traces are not a first-class proof artifact contract. | Standardize browser/E2E evidence receipts for UI and external-reality claims. |
| F9 Daemon health/version semantics | **PARTIAL / HIGH PRIORITY** | Worker has PID/lock/install/hold/cursor state. Stale lock cleanup is process-liveness oriented. | Introduce explicit worker health algebra: ALIVE, RESPONSIVE, HEALTHY, BUSY, STALE, VERSION_MISMATCH, HELD. |
| F10 Fail-closed degraded behavior | **IMPLEMENTED / REINFORCE** | Admission, authority, parser and mutation proofs already fail closed in many critical paths. | Reuse this law in new ingestion, worker-health and mutation-scope work. No new owner needed. |
| F11 Generated shared policy | **MISSING / IMPROVEMENT** | Shared contracts exist, but agent-specific operational instructions can still diverge. | Generate agent-facing policy fragments from canonical control contracts where practical. |
| F12 Decision-brief UX | **PARTIAL / IMPROVEMENT** | DIRECTIVE/REVIEW messages are structured and authority-bearing, but operator choice presentation has no unified decision-brief contract. | Add a reversible/irreversible decision schema to the operator-attention layer. |
| F13 Test-audit pruning | **PARTIAL / IMPROVEMENT** | Negative controls are unusually strong, but test-value/duplication pruning is not a canonical recurring process. | Add test portfolio audit as R&D/assurance maintenance; never use test count as quality proxy. |
| F14 Untrusted external content | **PARTIAL / REINFORCE** | The Continuous Intelligence Loop already marks external evidence as non-authoritative with provenance/trust. Runtime browser/connector prompt-injection controls remain separate work. | Preserve trust labels through ingestion and require promotion/reconciliation before authority. |

## Convergence with mattpocock/skills (Mining Run 001)

Two independent sources now reinforce the same architectural laws:

### Convergence C1 — small composable capability units

- mattpocock/skills: composable skills rather than monolithic workflows.
- gstack: specialist roles and skill routing.
- KEYFLOWOS: capability/tool registries and planned ephemeral agents.

**Converged law:** KEY should compose bounded capabilities/evaluator lenses around a mission. Do not create one universal mega-agent or duplicate permanent agent hierarchies.

### Convergence C2 — explicit task decomposition plus bounded authority

- mattpocock/skills: dependency graph and ready-frontier execution.
- gstack: narrow skills plus freeze/guard boundaries.
- KEYFLOWOS: packet DAGs, worktrees, allowed scope and control-plane admission.

**Converged law:** readiness and authority are separate. A task may be dependency-ready but must still possess an explicit capability grant before mutation.

### Convergence C3 — proof quality depends on proving the feedback loop

- mattpocock/skills: TDD/diagnosis and mutation proof.
- gstack: evidence-producing QA and explicit success sentinels.
- KEYFLOWOS: negative-control mutation tests and exact-head admission.

**Converged law:** a green result is valid only if the proving mechanism itself is shown capable of detecting the target defect.

### Convergence C4 — continuity is an artifact, not chat memory

- mattpocock/skills: explicit handoffs.
- gstack: context save/restore and checkpoint lineage.
- KEYFLOWOS: packet returns, repository control history and continuity protocol.

**Converged law:** session state must be reconstructable from durable, versioned, lineage-aware artifacts.

### Convergence C5 — learning must feed future execution

- mattpocock/skills: recurring architecture survey/feedback.
- gstack: learn + retro.
- KEYFLOWOS: Context Genome, learning services and Continuous Intelligence Loop.

**Converged law:** completed work is not closed until evidence/outcomes have an explicit disposition and valuable learning is available to later tasks without becoming ungoverned authority.

## Recommended bounded implementation packets

These are candidates, not authorization.

### Candidate A — KF-META-MUTATION-CAPABILITY-BOUNDARY-001

**Priority:** P0

Characterize every mutation channel available to a worker and design one shared authorization contract that maps packet authority to actual mutation capability.

Must cover at least:
- source file edits;
- shell commands that mutate files;
- git commit/branch operations;
- GitHub issue/PR mutations;
- schema/migration/database operations;
- external provider side effects.

**Proof obligation:** restoring an out-of-scope mutation path must fail a negative control.

**Anti-duplication:** extend the existing agent control plane; do not create a second authority system.

### Candidate B — KF-META-WORKER-HEALTH-STATE-001

**Priority:** P0

Define and implement worker state semantics separating:
- process alive;
- protocol responsive;
- healthy;
- busy;
- stale;
- version mismatch;
- held/retryable.

**Proof obligation:** a live-but-unresponsive worker cannot be silently classified as dead, healthy or safely replaceable.

### Candidate C — KF-META-REVIEW-LENSES-001

**Priority:** P1

Extend independent semantic review into explicit lenses while retaining one admission owner.

Initial lenses:
- architecture/semantic ownership;
- correctness/concurrency;
- security/authority;
- business logic/data integrity;
- product/UX only when relevant.

The output must reconcile findings into one admission disposition; lenses are evidence producers, not independent merge authorities.

### Candidate D — KF-KEY-LEARNING-RETRO-INGEST-001

**Priority:** P1

Wire accepted development outcomes into the existing intelligence/memory owners:
- merged PR findings;
- rejected/accepted reviewer findings;
- incidents;
- failed negative controls;
- correction loops;
- post-merge regressions.

Start by evolving `KnowledgeIngestionService`/existing memory services only after reachability and semantic-owner characterization. Do not create another knowledge store.

### Candidate E — KF-META-CONTEXT-CHECKPOINT-LINEAGE-001

**Priority:** P1

Define durable context checkpoint identity, lineage, supersession and branch/worktree resolution so stale state cannot shadow newer task state.

### Candidate F — KF-META-BROWSER-EVIDENCE-001

**Priority:** P2

Define a browser/E2E proof receipt:
- exact revision;
- environment;
- route/journey;
- actions;
- expected/observed result;
- screenshot/artifact references;
- console/network failures;
- trust classification for page-derived content.

## Recommended order

```text
A mutation capability boundary
        |
        +--> B worker health semantics
        |
        +--> C reviewer lenses
        |
        +--> E checkpoint lineage
        |
        +--> F browser evidence

D learning/retro ingestion begins with characterization in parallel,
but runtime wiring should wait until the ingestion/memory semantic owners
are reconciled and no duplicate store is introduced.
```

Reason: A closes the largest autonomous-execution safety gap. B attacks the worker/session ambiguity already observed operationally. C then increases review quality without weakening the existing exact-head gate. D is strategically important but touches a currently dormant/partially wired memory area and therefore requires more characterization before activation.

## What is already good enough not to replace

Do **not** replace:
- exact-head admission;
- independent semantic review ownership;
- negative-control mutation testing;
- bounded correction/hold behavior;
- dedicated worker worktrees;
- repository-as-durable-control-evidence model;
- existing KEY capability/memory/ingestion owners without proof they are semantically wrong.

## Net result

Mining Run 002 did not reveal a need for a new external framework. It produced six bounded implementation candidates and, together with Mining Run 001, strengthens five cross-source architectural laws.

The immediate high-value frontier is **least-authority mutation enforcement + explicit worker health semantics**. Those two changes directly reduce the class of failures where an autonomous worker is technically running and following a packet, yet its effective mutation scope or operational state is not mechanically knowable.

# Mined Source: garrytan/gstack

**Source ID:** EXT-GITHUB-GARRYTAN-GSTACK-002
**Repository:** garrytan/gstack
**Pinned revision:** `f67c478f05d8e0b39339599ad11c91a3478515ae`
**License:** MIT
**Mined:** 2026-10-07
**Status:** MINED / RECONCILIATION_CANDIDATE

## Why this source matters

gstack is an opinionated software-development operating layer for Claude Code. It packages specialist roles, review/QA/release workflows, persistent learning/context, browser evidence, and safety controls into composable skills rather than one undifferentiated coding agent.

For KEYFLOWOS, the repository is useful primarily as prior art for the **development organism around KEY**: governed specialist capability routing, staged planning/review, evidence-producing QA, persistent learnings and retrospectives, safety boundaries, and context restoration.

The source should be mined for patterns, not installed as a KEYFLOWOS runtime dependency.

## Findings

### F1 — specialist roles create explicit cognitive separation

gstack exposes distinct CEO, engineering, design, QA, security, release, documentation and review roles instead of asking one prompt to optimize every concern simultaneously.

**KEYFLOWOS mapping:** KEY capability registry, ephemeral specialist agents, evaluator/reviewer roles, software-development organism.

**Candidate disposition:** IMPROVEMENT / likely ABSORB.

### F2 — staged review pipelines reduce single-lens planning failure

The `autoplan` flow composes multiple review skills sequentially and preserves an explicit decision/approval stage rather than treating one plan generation pass as sufficient.

**KEYFLOWOS mapping:** plan -> independent review lenses -> reconciliation -> clearance -> execution. This reinforces the existing desire for architecture, security, correctness and business-logic review without collapsing them into one reviewer.

### F3 — project learning is a durable first-class artifact

The `learn` skill manages project learnings across sessions, while `retro` consumes prior retros, timeline events and recent learnings to identify trends.

**KEYFLOWOS mapping:** Context Genome, historical reconciliation, KEY memory, continuous intelligence loop, post-implementation learning.

**Candidate disposition:** STRONG IMPROVEMENT. KEYFLOWOS already has deeper durable-memory ambitions; gstack provides concrete ergonomics and lifecycle patterns rather than a replacement owner.

### F4 — retrospectives close the implementation-to-learning loop

gstack treats retrospective analysis as a recurring workflow over commit history, work patterns, code-quality signals and persisted project history.

**KEYFLOWOS mapping:** OBSERVE -> LEARN phase of the continuous intelligence loop; architecture drift review; development-performance feedback; failure-pattern harvesting.

### F5 — context save/restore should be explicit and recoverable

gstack includes dedicated context-save/context-restore capabilities and recent work specifically hardens recovery when checkpoints exist across nested repositories and worktrees.

**KEYFLOWOS mapping:** durable handoffs, task state, branch/worktree lineage, agent-session continuity, recovery after interruption.

**Candidate disposition:** IMPROVEMENT / reconcile with existing CURRENT-STATE, HANDOFF, task packet and Context Genome mechanisms.

### F6 — safety policy belongs in executable hooks, not prose alone

`careful`, `freeze` and `guard` encode destructive-command warnings, catastrophic hard-denies and directory-scoped edit boundaries into pre-tool hooks. The freeze logic is fail-closed when its boundary cannot be interpreted.

**KEYFLOWOS mapping:** control plane, edit leases, scoped authority, destructive-action approvals, production protection, worker packet constraints.

**Candidate disposition:** HIGH-VALUE PRIOR ART. This is especially relevant to preventing an autonomous worker from turning a scope instruction into a convention it can accidentally bypass.

### F7 — narrow edit boundaries are a practical form of capability containment

`freeze` separates what an agent may read from what it may modify and enforces the write boundary through hooks.

**KEYFLOWOS mapping:** task-scoped capability grants, worktree/edit-lock governance, least-authority execution.

**Important limitation:** gstack itself notes its Edit/Write boundary is not a complete security boundary because shell commands can still write outside the path. KEYFLOWOS therefore needs capability enforcement below the prompt/tool-choice layer for stronger guarantees.

### F8 — browser QA should produce observable evidence

gstack's architecture uses a real or persistent browser engine, labelled evidence lines, screenshots/artifacts, explicit success sentinels and bounded fallback behavior. Browser-returned content is treated as untrusted.

**KEYFLOWOS mapping:** UI/E2E verification, connector testing, external-reality evidence, proof artifacts, untrusted-input boundaries.

### F9 — persistent local tools need health, version and recovery semantics

The browser daemon maintains state, health checks, bounded responsiveness probes, atomic state files, automatic lifecycle and binary-version mismatch handling.

**KEYFLOWOS mapping:** worker/control-plane reliability, long-lived connector/helper processes, lease/health distinction, stale-worker recovery.

**Notable lesson:** process liveness and responsiveness are different states; a live but unresponsive process should not automatically be treated as dead.

### F10 — fail-closed/degraded-mode behavior should be explicit

Across gstack skills, missing or stale protocol/setup components trigger defined degraded behavior instead of silently assuming the system is healthy. Safety boundaries such as freeze deny malformed tool payloads rather than allowing them.

**KEYFLOWOS mapping:** no-fake-green, admission control, parser hardening, worker/control protocol versioning, proof-plane semantics.

### F11 — generated skill docs reduce instruction drift

gstack marks skill files as generated from templates and regenerates shared instruction surfaces rather than manually duplicating common policy everywhere.

**KEYFLOWOS mapping:** agent-policy generation, worker packet templates, shared control contracts, avoiding divergence between Claude/ChatGPT/Kimi instructions.

### F12 — decision UX is treated as part of agent architecture

gstack standardizes decision briefs with stakes, recommendations, completeness tradeoffs and explicit handling for destructive one-way decisions.

**KEYFLOWOS mapping:** approval UX, operator attention kernel, human-in-the-loop governance, KEY explanations before consequential actions.

### F13 — test-suite quality includes deleting low-value tests

The `test-audit` skill exists specifically to identify duplicate/low-value tests and test-only code they keep alive, with report-first behavior.

**KEYFLOWOS mapping:** assurance-quality maintenance, test portfolio optimization, avoiding fake confidence from test volume alone.

### F14 — external content and browser output are treated as untrusted evidence

The architecture explicitly fences page-controlled output and treats web research/browser responses as untrusted rather than executable authority.

**KEYFLOWOS mapping:** prompt-injection resistance, connector/content trust classification, provenance-aware R&D ingestion.

## Where this overlaps existing KEYFLOWOS work

Strong overlap exists with:
- continuous intelligence and reconciliation;
- Context Genome / durable memory;
- multi-agent development orchestration;
- worker edit locks / scoped work ownership;
- independent AI review gates;
- no-fake-green assurance;
- Living System Atlas / architecture drift detection;
- KEY's eventual skill/capability registry;
- operator approval and attention surfaces.

This overlap is useful because it provides **parallel implementation evidence**. It does not justify adding another scheduler, memory database, control plane or agent registry.

## Candidate adaptations

1. **Role-lens registry for development work**
   - Represent CEO/product, architecture, security, QA, UX and release as explicit review lenses attached to a task/mission.
   - Reuse KEY's capability/evaluator architecture rather than permanent standalone agents.

2. **Executable scope guards**
   - Turn worker packet scope and edit leases into enforceable tool/capability boundaries.
   - Preserve shell/process escape analysis instead of assuming file-edit hooks are sufficient.

3. **Decision-brief contract**
   - Standardize consequential KEY/operator decisions around issue, stakes, options, recommendation, reversibility and proof required.

4. **Learning/retro ingestion**
   - Feed merged PRs, incidents, failed gates, reviewer findings and resolved contradictions back into the continuous intelligence loop as normalized learning records.

5. **Context checkpoint lineage**
   - Harden continuity across branches/worktrees/sessions so the newest valid checkpoint is discoverable without allowing stale context to shadow newer task state.

6. **Daemon/process state law**
   - Distinguish ALIVE, RESPONSIVE, HEALTHY, BUSY, STALE and VERSION_MISMATCH instead of reducing worker state to process-exists/process-missing.

7. **Generated policy surfaces**
   - Generate shared agent-control instructions from canonical contracts to reduce divergence between Claude Code, ChatGPT, Kimi Code and future KEY-native workers.

8. **Evidence-first browser QA**
   - Attach structured browser evidence/artifacts to verification results, especially for critical end-to-end flows.

## Do not import blindly

gstack is optimized for a developer operating Claude Code, not for KEYFLOWOS's full product/runtime semantics. It does not by itself establish:
- multi-tenant business authority;
- financial truth;
- durable business-effect identity;
- connector reconciliation;
- production-grade capability security;
- KEYFLOWOS mission semantics;
- Context Genome semantic ownership;
- autonomous long-running business operations.

Its local hook protections are useful prior art but are explicitly not complete security boundaries.

The correct action is to **absorb proven control, workflow, learning and ergonomics patterns into existing KEYFLOWOS owners**.

## First reconciliation targets

- current Claude worker/control-plane admission and edit-lock model;
- AI review gate and reviewer-role separation;
- CURRENT-STATE / HANDOFF / task checkpoint lineage;
- Context Genome learning records;
- KEY capability/evaluator/ephemeral-agent architecture;
- test and no-fake-green proof contracts;
- browser/E2E evidence handling;
- operator approvals and decision surfaces;
- architecture-drift and retrospective loops.

## Follow-up questions

1. Which gstack safety hooks correspond to protections KEYFLOWOS currently expresses only as prose?
2. Can edit leases become enforceable capability grants across *all* mutation channels, not only Edit/Write tools?
3. Should reviewer roles be represented as evaluator profiles attached to a single task rather than separate permanent agents?
4. How should learnings/retros feed Context Genome without allowing derived interpretation to become authoritative architecture truth?
5. Can worker state adopt the liveness-versus-responsiveness distinction to eliminate current lock/session ambiguity?
6. Which shared agent instructions should be generated from canonical control contracts rather than duplicated across agent-specific files?

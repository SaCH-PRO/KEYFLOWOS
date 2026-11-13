# Mined Source: mattpocock/skills

**Source ID:** EXT-GITHUB-MATTPOCOCK-SKILLS-001
**Repository:** mattpocock/skills
**Pinned revision:** `f3fc5632f401156837ee3872f14fe33ccf1024ea`
**License:** MIT
**Mined:** 2026-10-07
**Status:** MINED / RECONCILIATION_CANDIDATE

## Why this source matters

The repository packages small, composable engineering skills intended for Claude Code, Codex and other agents. Its design emphasis is disciplined software engineering rather than monolithic "agent owns the whole process" automation.

The source is useful to KEYFLOWOS primarily as prior art for **skill composition, mission decomposition, feedback loops and development-agent ergonomics**.

## Findings

### F1 — small composable skills beat monolithic workflows
The source separates reusable model-invoked discipline from user-invoked orchestration. This maps naturally to KEYFLOWOS:
- mission/directive layer;
- reusable capability/skill layer;
- control/clearance layer;
- evidence/verification layer.

**Candidate disposition:** IMPROVEMENT / likely ABSORB.

### F2 — resolve ambiguity before execution
`grill-me`, `grill-with-docs` and domain-modeling patterns deliberately reduce requirement ambiguity before work begins.

**KEYFLOWOS mapping:** mission clarification, high-uncertainty task intake, domain/context refinement.

### F3 — shared domain language reduces agent drift
The repository uses glossary/domain-language practices so agents and developers share stable terminology.

**KEYFLOWOS mapping:** Context Genome, Atlas semantic ownership, mission vocabulary, skill/capability naming.

### F4 — spec -> dependency graph -> ready-frontier execution
`to-spec`, `to-tickets`, `implement-spec` and `wayfinder` express large work as dependency-aware tracer bullets and parallelize only the ready frontier.

**KEYFLOWOS mapping:** multi-gated mission DAGs, dependency-aware task orchestration, safe parallel execution.

### F5 — feedback rate constrains agent quality
TDD and disciplined diagnosis are encoded as reusable skills rather than optional advice.

**KEYFLOWOS mapping:** assurance loop, negative controls, exact-head proof, mission verification.

### F6 — debugging should prove the feedback loop itself
The pinned source revision specifically hardens diagnosing-bugs by proving a forced mutation landed before trusting the red signal.

**KEYFLOWOS mapping:** directly reinforces the existing "no fake green" principle and mutation/negative-control design.

### F7 — architecture maintenance is continuous
The repository treats architecture improvement as a recurring survey, not only a rescue after entropy has accumulated.

**KEYFLOWOS mapping:** Living System Atlas, periodic architectural drift/deepening review.

### F8 — code review should separate standards from spec fidelity
Independent review axes reduce contamination between "is this good code?" and "did this implement the requested behavior?"

**KEYFLOWOS mapping:** proof/review plane; potentially separate semantic-contract and engineering-quality reviewers.

### F9 — durable handoffs are explicit artifacts
The handoff skill compresses state so work can continue across agents/sessions.

**KEYFLOWOS mapping:** project continuity, Context Genome, historical reconciliation, mission state.

## Do not import blindly

This source does not solve KEYFLOWOS-specific requirements for:
- tenant isolation;
- durable business missions;
- delegated authority;
- approvals/clearance;
- financial effects;
- external connector safety;
- Context Genome/Atlas reconciliation;
- persistent business memory;
- long-running autonomous operations.

The correct action is to **adapt patterns into canonical KEYFLOWOS owners**, not install this repository as a runtime dependency.

## First reconciliation targets

- mission/goal decomposition;
- capability registry semantics;
- task-graph / ready-frontier execution;
- project glossary / domain model;
- handoff/continuity artifacts;
- diagnosis and mutation-proof loops;
- independent review lenses;
- recurring architecture survey.

## Follow-up questions

1. Which of these patterns are already implemented under different names?
2. Which are only present in development tooling and should later become KEY-native?
3. Which belong only to the software-development organism and should not leak into business mission semantics?
4. Where can ready-frontier execution reuse existing Saga/mission/task primitives instead of introducing another scheduler?
5. Can the independent review-lens pattern be expressed through the existing assurance/control architecture?

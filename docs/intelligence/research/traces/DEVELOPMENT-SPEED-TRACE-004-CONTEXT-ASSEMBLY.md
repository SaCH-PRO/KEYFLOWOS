# Development-Speed Trace 004 — Deterministic Context Assembly

Status: ACTIVE R&D / DESIGN CONVERGENCE
Authority: RESEARCH ONLY
Question: Can KEYFLOWOS compile the smallest sufficient, freshness-aware context packet for ChatGPT/Claude so agents retrieve project understanding instead of reconstructing it?

## Book lenses used in this trace

- Felienne Hermans, The Programmer's Brain — distinguish missing knowledge, retrieval failure and processing/working-memory overload; use external representations to reduce cognitive burden.
- Thomas/Hunt, The Pragmatic Programmer — automate repeated cognition; tracer-style bounded progress; contracts; orthogonality; do not outrun evidence.
- John Ousterhout, A Philosophy of Software Design — reduce complexity; prefer deep interfaces; decide what matters.
- Weinberg — comprehension before modification; empirical feedback.
- Brooks/Peopleware — coordination and context-switching cost.

These are lenses, not authorities over repository truth.

## 1. Current context path

The local Claude worker currently wakes a new non-interactive Claude session with a bounded prompt that tells it to:
1. read CLAUDE.md;
2. read AGENTS.md;
3. read EXECUTION_CONTROL_STANDARD.md;
4. read AGENT_CONTROL_PLANE.md;
5. read the entire issue #80 comment stream;
6. re-resolve main;
7. process the named message.

The worker passes packet/message identity and worktree/base information, but does not compile task-specific architecture, relevant historical failures, affected execution path or proof profile into the wake context.

This is safe and explicit, but it requires the newly woken agent to perform substantial rediscovery.

## 2. Context sources have different authority and freshness

Repository evidence already defines distinct roles:

- repository / PR / CI: implementation truth;
- newest valid ChatGPT authority on #80: execution authority;
- programme-state.yaml: derived projection that may be stale;
- intelligence branch: durable intent/checkpoint history;
- active-packet / claude-return: per-packet admission artifacts;
- architecture/: system maps and generated/reviewed architecture evidence;
- AGENTS.md / CLAUDE.md: operational guidance.

Trace 002B found that continuity documents can lag live repository history.

Therefore a context compiler cannot simply concatenate documents.

It must resolve:
AUTHORITY + FRESHNESS + RELEVANCE + PROVENANCE.

## 3. Failure diagnosis from The Programmer's Brain

When an agent appears confused, classify before adding context:

### KNOWLEDGE_ABSENT
The repository has no durable answer.
Action: investigate / ask / create evidence.

### RETRIEVAL_FAILURE
The answer exists but the task packet did not surface it.
Action: improve selection/indexing.

### CONTEXT_OVERLOAD
The answer is present among too much material.
Action: reduce context and improve representation.

### REPRESENTATION_FAILURE
The facts are present but poorly structured for the cognitive task.
Action: compile a graph/table/state machine/proof profile.

### REASONING_FAILURE
The required information and useful representation were available but the conclusion was wrong.
Action: change reasoning strategy/model/reviewer/proof.

This taxonomy should eventually be captured on correction outcomes so the context system learns why a task failed.

## 4. Candidate ContextBundle contract

Do not create a new source of truth.

ContextBundle is a generated projection over canonical sources.

```yaml
context_bundle:
  generated_at: <time>
  repository_head: <sha>
  packet_id: <id>
  authority:
    message_id: <id>
    source: issue_80
    freshness: current|stale|unverifiable

  task:
    change_class: <candidate>
    state: <packet-state>
    allowed_scope: []
    prohibited_scope: []
    stop_conditions: []

  semantic_context:
    owners: []
    journeys: []
    kernels: []
    execution_paths: []
    invariants: []

  evolution_context:
    hotspots: []
    historical_failure_classes: []

  proof_context:
    fastest_falsification: []
    semantic_proofs: []
    final_admission: []

  unresolved:
    contradictions: []
    unknowns: []

  provenance:
    - claim: ...
      source: ...
      revision: ...
      authority_class: ...
      freshness: ...

  excluded:
    - source: ...
      reason: irrelevant|stale|superseded|too_broad
```

The bundle must be reproducible from the same repository/control snapshot.

## 5. Selection algorithm

Candidate deterministic sequence:

1. RESOLVE SNAPSHOT
   - current main/head;
   - packet branch/head;
   - newest valid authority;
   - active packet.

2. CLASSIFY TASK
   - semantic change type;
   - affected paths;
   - risk domains.

3. MAP
   - architecture module/owner;
   - journeys/kernels;
   - runtime execution path;
   - data/effect boundaries.

4. RETRIEVE HISTORY
   - hotspot profile;
   - related correction classes;
   - known gotchas.

5. SELECT PROOF
   - microproof;
   - semantic proof profile;
   - final admission obligations.

6. RETRIEVE R&D
   - only adopted/candidate laws directly relevant to the task;
   - label research status so it cannot masquerade as architecture authority.

7. RANK
   Candidate priority:
   authority relevance
   > contradiction/safety relevance
   > live-path relevance
   > semantic ownership
   > risk
   > historical failure density
   > recency
   > general background.

8. EMIT BUNDLE
   - bounded;
   - provenance-rich;
   - explicit omissions;
   - no silent conflict resolution.

## 6. Deep-module interpretation

The context compiler is a good candidate for a deep module if its public interface stays small:

`compileContext(snapshot, task) -> ContextBundle`

Internally it may need:
- control-envelope parsing;
- git/repository state;
- architecture graph;
- intelligence retrieval;
- hotspot profiles;
- proof profiles.

But it must not hide:
- authority conflicts;
- stale sources;
- unknowns;
- contradictory evidence.

HIDE MECHANISM, NOT TRUTH.

## 7. Do not replace canonical reading blindly

Some control-plane documents contain safety rules whose omission could be dangerous.

Initial deployment model should therefore be additive:

CURRENT REQUIRED BASELINE
+
GENERATED TASK-SPECIFIC CONTEXT.

Only after measurement should the project consider replacing portions of broad mandatory reading with compiled representations.

## 8. Context-cache opportunity

Many agent wakes repeatedly rediscover:
- repo rules;
- packet semantics;
- architecture ownership;
- proof obligations;
- recent failure history.

A content-addressed ContextBundle can act as a cache keyed by relevant source revisions.

Invalidate when:
- authority changes;
- repository head changes in affected paths;
- architecture map revision changes;
- packet changes;
- contradiction status changes;
- proof profile changes.

Do not invalidate for unrelated repository changes unless they affect a declared dependency.

This is the potential acceleration mechanism.

## 9. Passive learning loop

After a task:
- record what context was supplied;
- record correction class;
- record reviewer findings;
- record proof failures;
- record whether missing context was later needed.

Then ask:
- which included context was never useful?
- what missing context caused rework?
- which representation reduced correction cycles?
- which task classes need which context?

This can empirically tune context selection without giving an LLM authority to rewrite architecture.

## 10. Candidate metrics

- context tokens/bytes per task;
- time from wake to first substantive repository operation;
- time to first falsifiable proof;
- number of broad-document reads;
- context reconstruction operations;
- corrections classified RETRIEVAL_FAILURE;
- corrections classified CONTEXT_OVERLOAD;
- reviewer findings caused by missing invariant/history;
- stale-context incidents;
- agent handoffs before completion.

Primary target:
MINIMUM SUFFICIENT CONTEXT FOR CORRECT ACTION.

Not minimum tokens.

## 11. Stacked R&D payoff

Hermans -> failure taxonomy and context selection.
Pragmatic Programmer -> automate repeated cognition and bounded tracer workflow.
Ousterhout -> deep task-facing context interface.
Tornhill -> hotspot/evolution inputs.
DDIA -> state/effect proof profiles.
Weinberg -> comprehension gate and empirical feedback.

Combined asset path:

BOOK RESEARCH
-> CONTEXT LAWS
-> ContextBundle contract
-> deterministic Context Compiler
-> Claude/ChatGPT task packet
-> fewer reconstruction cycles
-> outcome data
-> empirical routing/context improvement
-> eventual KEY cognitive-context capability.

## 12. Anti-bloat constraints

- no new truth store;
- no duplicate architecture graph;
- no hidden LLM summary as authority;
- no universal mega-prompt;
- no automatic conflict resolution;
- no deleting canonical documents merely because the compiler exists;
- no production implementation until architecture-forensics/admission authorizes it.

## 13. Next executable R&D step

TRACE 004B should prototype the ContextBundle against one historical packet without changing production:
- use KF-META-STATE-REDUCER-LIVE-001 as the sample;
- construct the bundle from existing evidence;
- compare it with the actual worker prompt + rediscovery/correction history;
- identify which historical correction classes the bundle could have surfaced before editing;
- measure approximate context reduction and missing information.

If the prototype is useful, the next candidate asset is a deterministic `compile-context` script under the existing agent-control/codebase-architect ecosystem, not a new service.


# Book × GenAI Trace — Live ContextBundle Promotion

Status: MICROSCOPIC TRACE COMPLETE / IMPLEMENTATION READY V1  
Authority: RESEARCH_ONLY  
Live worker inspected: `main@ac3a6384417093f198bcc7d672b0dbc295db137c`  
Worker blob: `scripts/agent-control/claude-worker.ps1@590b0a403d82604ec9d7b1f451d7dda9019ab0da`

## Question

Can the research ContextBundle become useful in the autonomous development worker without creating another authority source or widening the worker's powers?

## Live worker behavior

The current local worker:
1. polls issue #80;
2. uses the shared control-envelope parser through `select-directive.ps1/mjs`;
3. selects a bounded structure:
   - message_id
   - message_type
   - packet_id
   - source_main
   - implementation_branch
   - created_at
   - url
   - author
4. creates/reuses an isolated worktree;
5. builds a static Claude prompt telling it to read broad control documents and issue #80;
6. invokes `claude -p`;
7. requires an explicit completion marker and independently evaluates the run.

The worker currently does not compile a task-specific semantic context projection before wake.

## Research prototype behavior

`scripts/agent-control/research/compile-context.mjs` already proves a deterministic ContextBundle core with:
- explicit authority classes;
- freshness;
- VALID / DEGRADED / INVALID health;
- current authority identity;
- conflicts;
- task scope and stop conditions;
- semantic owners/journeys/kernels/execution paths/invariants/hotspots;
- proof-profile selection;
- unresolved contradictions/unknowns;
- provenance;
- explicit exclusions;
- RESEARCH_ONLY non-promotion.

It is deliberately fixture-driven and not wired to the worker.

## Key design conclusion

Do NOT jump directly from the research compiler to an all-knowing repository context engine.

The first live packet should promote only the deterministic **ContextBundle contract + control snapshot** and inject it read-only into the existing worker prompt.

Broad semantic source selection can evolve later after measured dry runs.

This keeps the first packet small and preserves authority.

## Live V1 ContextBundle inputs

All are deterministic and already available at wake time:

### Execution authority
From the selected, authenticated issue #80 envelope:
- message_id;
- message_type;
- packet_id;
- source_main;
- implementation_branch;
- comment URL/author;
- created_at.

Authority class: EXECUTION_AUTHORITY.

### Repository implementation truth
After worker `git fetch` / worktree creation:
- `origin/main` SHA;
- worktree base SHA;
- current checked-out HEAD;
- branch existence/head if present.

Authority class: IMPLEMENTATION_TRUTH.

### Control projection
If present:
- `.agent-control/active-packet.yaml`
- `.agent-control/claude-return.yaml`

Authority class: DERIVED_PROJECTION unless separately validated.
These may be stale by design during semantic-review stages and must never override issue authority.

### Static canonical architecture references
The V1 bundle may list required documents by source+revision, but should not summarize their prose itself:
- `CLAUDE.md`
- `AGENTS.md`
- `docs/development/EXECUTION_CONTROL_STANDARD.md`
- `docs/development/AGENT_CONTROL_PLANE.md`

The existing worker may continue requiring Claude to read them. The first packet is an indexing/provenance improvement, not a replacement.

## V1 health semantics

INVALID:
- authenticated selected authority is missing/malformed;
- source_main cannot be resolved;
- worker current main conflicts with source_main where the directive requires equality;
- bundle generator violates schema.

DEGRADED:
- derived active-packet artifact is stale/conflicting;
- optional architecture reference missing;
- optional proof-profile mapping unavailable.

VALID:
- required authority + implementation revision are current and bound;
- optional derived projections do not conflict.

Important:
A DEGRADED bundle does not automatically prohibit processing if the existing control protocol allows the specific condition. It reports context health; the underlying worker/control protocol remains authoritative.

## V1 prompt integration

Add a bounded block before the existing protocol instructions:

```
COMPILED CONTEXT (read-only projection; never overrides issue authority):
<ContextBundle>
```

Then explicitly retain:

`Issue #80 authority and the control-plane protocol remain authoritative. If the bundle conflicts with them, report the conflict and follow the protocol; do not silently choose the bundle.`

The worker still tells Claude to read the same required files in V1.

## Exact implementation shape

Proposed live files:

1. New:
   `scripts/agent-control/lib/context-bundle.mjs`
   - promote/generalize the deterministic pure compiler core from research;
   - no network;
   - no LLM.

2. New:
   `scripts/agent-control/build-worker-context.mjs`
   - accepts selected directive JSON + repository/worktree revision inputs;
   - optionally reads control projections;
   - emits deterministic YAML/JSON to stdout;
   - does not write tracked files.

3. Modify:
   `scripts/agent-control/claude-worker.ps1`
   - after worktree creation/revision validation, invoke builder;
   - capture bundle text;
   - fail closed only if required V1 bundle generation fails;
   - embed bundle in the prompt;
   - do not add any new allowed tool.

4. Tests:
   - pure ContextBundle tests;
   - builder fixture tests;
   - worker proof tests proving prompt injection and failure behavior.

Research schemas/proof profiles stay documentation/research inputs unless the implementation packet explicitly promotes a stable copy.

## Why stdout, not a generated worktree file

The worker refuses to remove a dirty worktree. Writing an untracked context file into the worktree would create cleanup/false-dirty behavior.

The first packet should generate the bundle in memory/stdout and interpolate it into the prompt, or write only to the worker's external state directory if a persisted diagnostic is required.

## V1 proof obligations

CTX-LIVE-P01 same selected directive + same repository revisions => byte-identical bundle.
CTX-LIVE-P02 different main/worktree revision changes the bound snapshot.
CTX-LIVE-P03 bundle cannot promote derived active-packet state above authenticated issue authority.
CTX-LIVE-P04 stale derived control artifact is visible as DEGRADED, never silently preferred.
CTX-LIVE-P05 missing authenticated authority makes generation/worker processing fail closed.
CTX-LIVE-P06 bundle text is injected into Claude prompt before execution.
CTX-LIVE-P07 existing required document reads remain in prompt for V1.
CTX-LIVE-P08 no new Claude allowed tool or credential is added.
CTX-LIVE-P09 no tracked/untracked file is left in the worktree solely from context compilation.
CTX-LIVE-P10 worker completion marker/evaluator semantics remain unchanged.
CTX-LIVE-P11 mutation control: flip authority precedence or accept missing source_main and named tests fail.
CTX-LIVE-P12 worker still treats issue #80 as execution authority when bundle and derived artifact disagree.

## Non-goals

- no full repository summarizer;
- no semantic vector retrieval;
- no Context Genome production runtime;
- no new memory store;
- no authority resolution by LLM;
- no change to issue #80 parser/allowlist;
- no change to merge authority;
- no replacement of required control docs in V1.

## Stop conditions

- implementation needs a new credential/network service;
- compiler would have to infer authority using an LLM;
- write set collides with another active control-plane worker packet;
- worker cannot fail closed on a malformed required bundle without creating a retry loop not handled by the existing bounded-attempt policy;
- exact release-base worker has materially changed from the traced seam.

## Sequencing

This is implementable, but it touches `claude-worker.ps1`.

Therefore release only after:
- active packet write-set collision check;
- exact current-main rebinding;
- existing worker contract tests are included.

If another packet owns the worker, BG-1 waits rather than forking a second worker.

## Disposition

`KF-META-CONTEXT-COMPILER-LIVE-001` is IMPLEMENTATION_READY V1.

Future V2 may compile task-specific architecture slices once V1 proves measurable reductions in context reconstruction without correctness regressions.

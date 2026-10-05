# KF-AGENT-PARALLEL-ORCHESTRATION-PLAN-001

Status: PLANNING
Created: 2026-10-05
Baseline main: 6fdffc26c7c7748d5c09900535c97c197864ab54

## Objective

Reduce KEYFLOWOS completion time by safely scaling from the current single local
Claude worker into multiple isolated implementation/review workers operating in
parallel on non-overlapping packets, while preserving one canonical programme,
one authority plane, exact-head proof, and serialized admission/mutation.

## Current repository reality

Today the local worker is intentionally single-instance:
- one exclusive worker PID lock;
- one actionable DIRECTIVE/REVIEW selected from issue #80;
- one Claude Code invocation per wake;
- one dedicated worktree per wake;
- global serialization for programme mutation/merge/checkpoint.

This is safe, but it leaves implementation throughput on the table.

The repository already defines the multi-agent target in Platform Convergence
Phase 9:
- KF-AGENT-001 worktree-per-packet;
- KF-AGENT-002 machine-readable file claims;
- KF-AGENT-003 semantic/domain/entity/journey/kernel claims;
- KF-AGENT-004 conflict admission and non-overlap proof;
- KF-AGENT-005 standardized Claude RETURN with reviewer disposition;
- KF-AGENT-006 optional secondary/adversarial agent;
- KF-AGENT-007 unattended next-packet launch after checkpoint.

The missing piece is a scheduler/dispatcher that can legally launch more than
one builder at once without allowing overlapping mutation.

## Target architecture

```
                    ChatGPT / Architecture Authority
                               |
                        Programme Scheduler
                               |
                 dependency + conflict selector
                               |
        +----------------------+----------------------+
        |                      |                      |
   Claude Worker A        Claude Worker B        Claude Worker C
   packet/worktree A      packet/worktree B      packet/worktree C
        |                      |                      |
        +---------- isolated branches/PRs -----------+
                               |
                    Independent review / proof
                               |
                     SERIAL ADMISSION / MERGE
                               |
                              main
```

## Core law

Parallelize **work**, not **authority**.

Allowed in parallel:
- read-only characterization;
- implementation on independent packets;
- tests in isolated worktrees;
- architecture-map generation on packet branches;
- independent review;
- documentation/protocol work;
- memory/Atlas/infra work when file/semantic claims do not overlap.

Serialized:
- mutation of canonical programme state;
- merge/admission;
- checkpoint advancement;
- resolution of contradictions;
- architecture precedence decisions;
- release of new overlapping packets;
- production/provider effects.

## Required worker identity

Every running worker must have:

```yaml
worker_id: claude-01
session_id: ...
packet_id: ...
branch: ...
worktree: ...
source_main: ...
claimed_files: [...]
claimed_domains: [...]
claimed_entities: [...]
claimed_journeys: [...]
claimed_kernels: [...]
started_at: ...
heartbeat_at: ...
state: CHARACTERIZING|IMPLEMENTING|PROVING|BLOCKED|RETURNED
```

## Claims model

A worker must acquire claims before mutation.

### File claims
Exact repository paths or bounded globs.

### Semantic claims
At minimum:
- domains;
- entities/models;
- journeys;
- kernels;
- migrations/schema;
- shared services;
- generated architecture outputs.

Two workers may proceed only when their write claims are non-overlapping or an
explicit merge strategy proves composability.

Read claims may overlap freely.

## Conflict classes

```
NONE
FILE_OVERLAP
SEMANTIC_OVERLAP
SCHEMA_OVERLAP
GENERATED_ARTIFACT_OVERLAP
SHARED_CONTROL_SURFACE
DEPENDENCY_NOT_MET
UNKNOWN
```

UNKNOWN fails closed.

## Worktree strategy

Use one worktree per packet, not merely per issue comment.

Proposed root:

`%LOCALAPPDATA%\KEYFLOWOS\agent-worktrees\<packet_id>\<worker_id>`

A packet branch may be owned by only one builder at a time unless the packet is
explicitly split into child branches with non-overlap proof.

## Scheduler algorithm

1. Read canonical programme state, issue #80 authority and repository truth.
2. Enumerate dependency-ready packets.
3. Exclude HELD/BLOCKED/active-overlap packets.
4. Load file and semantic claim sets.
5. Build a conflict graph.
6. Choose a maximum safe independent set of packets.
7. Assign workers up to configured concurrency.
8. Create/reuse isolated worktrees.
9. Launch Claude Code non-interactively with packet-bounded context.
10. Track heartbeat and completion marker.
11. On RETURN, release claims but retain branch/worktree until pushed/clean.
12. Route through ordinary independent review and exact-head admission.
13. Merge/checkpoint serially.
14. Recompute dependency-ready set and launch next legal work.

## Initial concurrency

Do not jump directly to unbounded workers.

Rollout:
- Stage 0: current single worker.
- Stage 1: 2 builders, no overlapping shared/control/schema files.
- Stage 2: 3 builders + one independent reviewer.
- Stage 3: adaptive N workers based on CPU/RAM/API limits and conflict density.

Default first target: `max_builders = 3`.

## Dedicated worker state

Replace the one global `.agent-control/.worker/worker.lock` as the only
execution lock with:

```
.agent-control/.workers/
  scheduler.lock
  workers/
    claude-01.json
    claude-02.json
    claude-03.json
  claims/
    <packet-id>.yaml
  cursors/
    claude-01.json
    claude-02.json
    claude-03.json
```

Runtime/local files remain git-ignored. Machine-readable packet claims that form
part of review/admission should live in committed packet artifacts.

## Authority / issue #80

Issue #80 remains the authority bus.

The current "newest actionable authority wakes one worker" selector must evolve
into a dispatcher that can recognize multiple simultaneously released,
dependency-safe packet directives.

The dispatcher must never infer parallel permission solely from multiple open
PRs.

A packet must be:
- explicitly released;
- dependency-ready;
- not held;
- not semantically/file-conflicting with another active write packet.

## Reviewer separation

Builder and reviewer identities must remain different.

Possible first deployment:
- Claude Code session A/B/C = builders;
- ChatGPT = architecture authority + fallback semantic reviewer;
- Copilot = primary independent reviewer when available;
- optional Kimi = secondary adversarial reviewer after its role contract is
  enabled.

No worker self-approves.

## Integration with Living System Atlas

The Atlas should expose:
- active workers;
- packets;
- file claims;
- semantic claims;
- dependency edges;
- conflict edges;
- current worktrees;
- PRs;
- proof state;
- blockers;
- critical path.

Mission Control consumes this projection.

## No-fake-speed law

Parallel execution is beneficial only when it lowers critical-path time without
raising rework.

Measure:
- packet lead time;
- queue wait;
- conflict/rebase rate;
- failed proof rate;
- duplicate work rate;
- merge contention;
- average active builders;
- critical-path completion rate.

If parallelism increases conflict/rework above the gain, scheduler concurrency
must reduce automatically.

## Safety constraints

- no concurrent schema/migration writers initially;
- no concurrent edits to agent-control authority code initially;
- no concurrent writers to the same generated architecture artifacts;
- no two builders own the same packet;
- no shared interactive checkout;
- no branch checked out in multiple worktrees;
- no automatic contradiction resolution;
- no parallel merge/checkpoint mutation;
- no production/provider traffic from builders.

## Implementation packets

### KF-AGENT-001 — packet worktree ownership
Upgrade the worker model from per-wake isolation to durable packet/worktree
ownership and per-worker runtime identities.

### KF-AGENT-002 — machine-readable file claims
Add packet file claims, validation and overlap detection.

### KF-AGENT-003 — semantic claims
Add domain/entity/journey/kernel/schema/shared-surface claims using Living Atlas
IDs.

### KF-AGENT-004 — conflict graph + safe selector
Build dependency/conflict graph and select safe parallel packet sets.

### KF-AGENT-005 — multi-worker dispatcher
Launch and supervise multiple Claude sessions with bounded prompts, heartbeat,
retry and completion markers.

### KF-AGENT-006 — independent reviewer lane
Integrate optional secondary reviewer without builder identity overlap.

### KF-AGENT-007 — unattended refill
When a worker returns/checkpoints, automatically schedule the next
dependency-safe non-conflicting packet.

## Recommended acceleration

Because the current single-worker bottleneck directly slows all later work,
implement a **minimal acceleration slice early** rather than waiting for all
Platform Phase 9 infrastructure:

1. packet-owned worktree identity;
2. committed file claims;
3. conservative conflict detector;
4. two parallel Claude builders;
5. retain globally serialized admission.

Then harden semantic claims and adaptive scheduling incrementally.

## Immediate next action

Do not interrupt the currently active ACTION-001 worker/review cycle.

After ACTION-001 emits its next clean RETURN/control checkpoint, release a
bounded `KF-AGENT-PARALLEL-MVP-001` packet to implement:
- two builder slots;
- per-packet worktrees;
- per-packet claims;
- fail-closed overlap detection;
- single serialized admission lane.

This is the minimum change that can materially reduce wall-clock completion time
without weakening control-plane correctness.

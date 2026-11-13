# Research Track — Development Speed, Simplicity and Verification

Status: ACTIVE R&D TRACK
Authority: RESEARCH ONLY

## Purpose

Use research on developer practice, cognitive flow, complexity management, refactoring and testing to reduce KEYFLOWOS time-to-correct-completion without creating fake speed.

The primary optimization target is not raw code output.

Target metric:

NET VERIFIED THROUGHPUT =
useful accepted change
- rework
- coordination cost
- regression cost
- architecture drift
- debugging delay
- context reconstruction cost.

## Core sources

- The Pragmatic Programmer — David Thomas and Andrew Hunt
- Flow — Mihaly Csikszentmihalyi
- A Philosophy of Software Design — John Ousterhout
- Refactoring — Martin Fowler
- Test-Driven Development: By Example — Kent Beck

Related existing sources:
- The Programmer's Brain
- Peopleware
- The Mythical Man-Month
- The Practice of Programming
- Clean Code
- Software Design X-Rays
- SICP
- DDIA

## Candidate acceleration laws

### 1. Shorten feedback distance
A failure discovered immediately is cheaper than a failure discovered after multiple dependent edits.

Potential KEYFLOWOS applications:
- fast focused tests before broad CI;
- compile/typecheck at semantic boundaries;
- characterization tests before risky refactors;
- real-database negative controls where mocks cannot prove behavior;
- explicit stopping conditions for repeated failed attempts.

### 2. Automate repeated cognition
Anything an agent repeatedly reconstructs should be considered for durable representation or deterministic tooling.

Candidate examples:
- dependency and ownership scans;
- execution-path retrieval;
- task context packet assembly;
- branch/CI state inspection;
- repeated forensic checklists;
- hotspot/change-coupling analysis.

Automation should remove mechanical work, not remove engineering judgment.

### 3. Preserve momentum by reducing context switching
Human flow research and Peopleware suggest interruption has cost. The AI analogue is not subjective "flow" but operational continuity.

Candidate measures:
- context packet completeness;
- unnecessary agent handoffs;
- number of unrelated task switches;
- repeated repository rediscovery;
- stale-context corrections;
- time/operations between verified state transitions.

### 4. Prefer deep semantic modules over shallow abstraction chains
Ousterhout's deep-module idea should be pressure-tested against KEYFLOWOS.

Candidate test:
A module is valuable when its interface exposes a small, coherent semantic contract while containing substantial necessary complexity.

Warning:
A "deep module" must not hide authority, failure, side effects, recovery or evidence semantics that callers need to reason safely.

### 5. Orthogonality means bounded change impact, not magical independence
The Pragmatic Programmer's orthogonality idea may help identify architecture where one change unnecessarily fans out across unrelated concepts.

Measure through:
- static dependency fanout;
- change coupling;
- test blast radius;
- semantic owner count;
- number of coordinated writers;
- cross-module regression frequency.

Do not claim feature A can "never" affect feature B merely because interfaces appear decoupled.

### 6. Tracer development can reduce speculative build cost
Use thin, end-to-end reachable slices to validate a path before expanding.

For KEYFLOWOS:
entry -> authorization -> domain mutation -> persistence -> event -> effect -> reconciliation -> user/operator projection.

A tracer is not production completeness. It is evidence that the proposed path is reachable and coherent.

### 7. Refactor with behavioral preservation evidence
Fowler-style small transformations can be valuable for converging duplicate architecture, but KEYFLOWOS needs stronger proof when semantics change.

Distinguish:
- behavior-preserving refactor;
- semantic migration;
- authority migration;
- data migration;
- state-machine change.

Only the first can rely primarily on characterization equivalence.

### 8. TDD is one proof strategy, not the proof strategy
Candidate usage:
- pure functions;
- state transitions;
- parsers;
- authorization rules;
- idempotency algebra;
- edge-case-heavy deterministic logic.

Prefer other approaches where appropriate:
- characterization-first for legacy behavior;
- integration tests for persistence/transactions;
- real-database tests for tenancy/query semantics;
- end-to-end tests for workflows;
- provider simulators for external effects;
- adversarial tests for retries/crashes/concurrency.

Candidate law:
GREEN TESTS != COMPLETE PROOF.

### 9. Fail fast, but fail at the right boundary
Early validation can reduce debugging time.

However, KEYFLOWOS must distinguish:
- invalid input;
- denied authority;
- unavailable dependency;
- unknown provider outcome;
- recoverable transient failure;
- partial commit;
- business rejection.

Collapsing all of these into "fail fast" would destroy useful state semantics.

### 10. Simplicity must be measured by cognitive and operational burden
Fewer lines or fewer classes are not automatically simpler.

Candidate dimensions:
- concepts a caller must understand;
- number of sources of truth;
- number of state transitions;
- number of representations;
- failure modes exposed;
- coordination burden;
- change blast radius;
- operational dependencies.

## Immediate repo-facing questions

1. Which active KEYFLOWOS modules are shallow abstraction chains?
2. Which high-change hotspots cause disproportionate rework?
3. Which CI/proof cycles could be reordered to fail earlier without weakening proof?
4. Which agent handoffs repeatedly reconstruct the same context?
5. Which repeated forensic operations should become deterministic tools?
6. Where are we using mocks where only a real database can prove the invariant?
7. Which implementation packets could use tracer slices before full build-out?
8. Which "green" tests have weak mutation/negative-control strength?
9. Which cross-module edits violate intended orthogonality?
10. Which refactors are actually semantic migrations and should be treated as such?

## Proposed acceleration metric

For each future research-derived change, track:

- time to first falsifiable proof;
- number of correction cycles;
- number of agent handoffs;
- repeated-context reconstruction;
- CI failures by repeated root cause;
- review defects;
- post-merge regressions;
- architecture drift introduced/removed;
- verified useful scope completed.

Research succeeds only if it improves correctness, clarity or time-to-correct-completion. A practice that merely increases code velocity while increasing rework is not an acceleration.

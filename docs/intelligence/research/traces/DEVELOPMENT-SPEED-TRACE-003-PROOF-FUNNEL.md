# Development-Speed Trace 003 — Proof Funnel and CI Latency

Status: ACTIVE R&D / REPO PRESSURE TEST
Authority: RESEARCH ONLY
Question: How can KEYFLOWOS falsify bad changes earlier without weakening final admission evidence?

## Evidence inspected

Live repository evidence at/through the current PR #120 merge history:
- `.github/workflows/ci-cd.yml`
- `.github/workflows/agent-control-gate.yml`
- `.github/workflows/agent-control-worker-proof.yml`
- `scripts/agent-control/negative-controls.yaml`
- `package.json`
- recent TENANT, EXTFX and state-reducer correction history.

## 1. The repository already contains a proof funnel — but it is only partially explicit

Current broad CI roughly behaves as:

SOURCE
  -> dependency install / generated clients / workspace builds
  -> server + web type checks
  -> parallel build/test/security/lint branches
  -> real Postgres + Redis integration environment
  -> migrations
  -> server build
  -> full server suite
  -> K12 proof admission
  -> web structural tests
  -> exact-head workflow admission.

Agent-control adds:
- artifact shape/binding;
- source-head ancestry and control-only tail;
- exact-head workflow requirements;
- portable control-plane proofs;
- Windows worker proof;
- mutation-based negative controls.

This is substantially stronger than ordinary "unit tests green" CI.

## 2. Existing history already demonstrates why ordering matters

The CI file documents several prior proof failures:
- lint debt once sat in front of type checks/tests and caused security/tenant gates to be skipped;
- fresh CI checkouts exposed workspace-package declaration dependencies hidden by stale local dist artifacts;
- Next type generation could exit 0 without producing the required file, requiring an explicit emitted-artifact assertion;
- a server could compile and pass tests yet die during module loading;
- important server integration tests and web structural suites previously existed but were outside CI.

This is direct repository evidence for:

FAIL EARLY, BUT NEVER LET A LOW-VALUE FAILURE SILENCE HIGH-VALUE SAFETY EVIDENCE.

The current split of lint from the typecheck dependency chain is a concrete example of that law.

## 3. Type checking is currently a broad fan-out gate

`build-server`, `build-web` and `test` all need `lint-and-typecheck`.

Benefit:
- cheap structural/compiler failures stop expensive jobs.

Cost:
- a type error prevents the broad test suite from running, which can hide independent behavioral failures until the type error is repaired.

This is not automatically wrong. It means the funnel should distinguish:

### Local/packet falsification
Run highly targeted behavioral proof before push where possible.

### CI economy
Use typecheck to avoid expensive doomed fan-out.

### Final admission
Require the full broad proof after all targeted corrections.

Candidate law:
A FAST GATE MAY SHORT-CIRCUIT COMPUTE, BUT IT MUST NOT BE MISTAKEN FOR COMPLETE EVIDENCE.

## 4. Repeated setup cost is visible

Several CI jobs independently:
- checkout;
- setup pnpm;
- setup Node;
- install frozen dependencies;
- generate Prisma;
- build shared/db/api packages.

This repetition buys isolation and reduces hidden cross-job state, which is valuable. It also consumes time.

Research candidate:
measure before changing. Potential optimizations include dependency/cache improvements or artifact reuse only if they preserve clean-checkout semantics.

Do not trade away the fresh-environment property that previously exposed stale-dist defects.

Candidate law:
CACHE DOWNLOADS; DO NOT CACHE ASSUMPTIONS.

## 5. The strongest proof primitive in the control plane is mutation sensitivity

`negative-controls.yaml` does something more valuable than ordinary green testing:
- names a critical claim;
- restores a known defect;
- requires the proof to fail;
- reports a surviving proof as VACUOUS.

This directly operationalizes the R&D principle:

PROVE THE TEST CAN FAIL FOR THE DEFECT IT CLAIMS TO CATCH.

This should be studied for selective reuse outside agent-control.

Potential domains:
- tenant isolation;
- authorization;
- payment/effect identity;
- destructive operations;
- reconciliation;
- memory/epistemic authority.

Do not mechanically mutation-test the entire repository. Apply to high-risk invariants where a specific defect can be restored deterministically.

## 6. Proof selection should be semantic

Today broad CI is mostly workflow-static.

R&D candidate:

CHANGE CLASSIFICATION
  -> REQUIRED TARGETED PROOFS
  -> BROAD FINAL CI.

Examples:

### PURE LOCAL LOGIC
- unit/characterization;
- typecheck;
- affected integration;
- final broad CI.

### TENANT/AUTHORITY
- real DB;
- cross-tenant negative cases;
- pagination completeness;
- stale/revoked authority;
- mutation-sensitive invariant proof;
- final broad CI.

### EXTERNAL EFFECT
- deterministic provider simulator;
- duplicate;
- timeout;
- crash/restart;
- effect identity;
- reconciliation;
- final broad CI.

### SCHEMA/MIGRATION
- migration apply;
- compatibility/read-write behavior;
- backfill classification;
- rollback/recovery where applicable;
- final broad CI.

### CONTROL PLANE
- portable suite;
- Windows worker where relevant;
- negative controls;
- exact-head binding;
- final admission workflows.

This is a candidate Proof Profile Registry.

## 7. A proof registry can become a passive development tool

Candidate generated contract:

```yaml
change_class: EXTERNAL_EFFECT
required_fast_proof:
  - affected_typecheck
  - provider_simulator
  - effect_identity
required_adversarial:
  - duplicate
  - timeout
  - crash_before_persist
  - provider_accepted_response_lost
  - retry_after_restart
required_final:
  - full_ci
  - exact_head_admission
```

A context/task compiler could infer candidate change classes from:
- changed files;
- architecture ownership;
- journey/kernel;
- semantic hotspot history;
- packet declaration.

Human/canonical packet authority would still resolve ambiguity.

## 8. Three proof layers

### Layer A — microproof
Goal: seconds/minutes.
Question: is the proposed local idea already false?

Examples:
- one parser test;
- one state transition test;
- one typecheck target;
- one deterministic reproduction.

### Layer B — semantic proof
Goal: prove the actual contract being changed.

Examples:
- real DB tenant isolation;
- deterministic provider simulator;
- state-machine recovery;
- mutation-sensitive invariant;
- reachability trace.

### Layer C — admission proof
Goal: prove repository/system compatibility at the exact candidate head.

Examples:
- full CI;
- build;
- broad integration;
- branch divergence;
- DAST workflow;
- control artifacts/review;
- exact-head requirements.

Acceleration should primarily optimize A and B. C remains deliberately broad.

## 9. Reachability gate belongs before expensive refinement

The codebase map's dominant historical failure mode is written/registered/unconnected code.

Therefore before deep implementation or polishing, a relevant packet should prove:

EXISTS
-> REGISTERED
-> INJECTED/BOUND
-> CALLED/DRIVEN
-> OBSERVABLE ON INTENDED RUNTIME PATH.

For UI:
ROUTE EXISTS
-> NAVIGATION/CALLER EXISTS
-> BACKEND CONTRACT EXISTS
-> USER CAN REACH IT.

For background systems:
REGISTRATION
-> TRIGGER
-> HANDLER
-> PERSISTED/EXTERNAL EFFECT
-> FEEDBACK/OBSERVABILITY.

This can prevent high-quality work on inert code.

## 10. Proof evidence has different epistemic strength

The current system already reveals a hierarchy:

- source compiles;
- test is green;
- test fails under restored defect;
- integration works against real DB;
- deterministic provider simulation works;
- built artifact loads;
- runtime path is reachable;
- exact-head broad CI is green;
- external real-world outcome is reconciled.

These are not interchangeable.

This connects the acceleration track to the Epistemic Kernel:
PROOF STATUS MUST NAME WHAT WAS ACTUALLY PROVED.

## 11. Security evidence needs precise semantics

The CI security job currently uses `continue-on-error: true` for dependency audit and TruffleHog steps.

Therefore a green overall workflow must not be interpreted as proof that those scans found nothing.

This is not necessarily a defect: some scanners may intentionally be advisory. But evidence/reporting must preserve that distinction.

Candidate law:
WORKFLOW SUCCESS != EVERY CHECK SATISFIED.

This is another instance of the Epistemic Kernel law:
INTEGRITY/EXECUTION STATUS != BUSINESS/SECURITY TRUTH.

## 12. Windows worker proof is deliberately broad

The worker proof has no path filter because exact-head implementation PR proof was intentionally required and Windows-specific behavior cannot be proven on Ubuntu.

Optimization must not simply add path filters.

Research question:
can unchanged control-plane content be represented by a content-addressed proof artifact plus exact-head binding, while still proving the PR did not alter its assumptions?

No recommendation yet. This requires security/control-plane analysis before any implementation.

## 13. Candidate deterministic tool — Proof Planner

Inputs:
- changed files;
- semantic owners;
- change class;
- hotspot/failure history;
- packet;
- risk;
- external-effect/schema/auth flags.

Outputs:
- fastest falsification command;
- required semantic proofs;
- mutation controls;
- required integration environment;
- final admission gates;
- evidence labels.

Potential workflow:

TASK
  -> classify semantic change
  -> reachability check
  -> microproof
  -> semantic proof
  -> implementation/correction
  -> broad exact-head admission
  -> outcome capture
  -> update failure history.

## 14. R&D stacked payoff

This trace can yield:
1. proof taxonomy;
2. Proof Profile Registry;
3. deterministic Proof Planner;
4. CI command selection;
5. task-packet proof section;
6. agent self-check skill;
7. KEY software-engineering capability;
8. evidence for empirical agent-performance scoring.

## 15. Candidate metrics

Measure before and after any proof-funnel change:
- time to first falsifiable result;
- time to first root cause;
- targeted proof runs;
- full CI runs per admitted packet;
- correction commits per packet;
- repeated root-cause failures;
- vacuous tests/controls discovered;
- reviewer findings after claimed green;
- final CI wall-clock;
- post-merge regression count.

Optimization target:

VERIFIED USEFUL CHANGE / WALL-CLOCK

subject to:
- no reduction in final proof obligations;
- no hidden skipped evidence;
- no fake green;
- no production side effects.

## 16. Next trace

DEVELOPMENT-SPEED-TRACE-004 — DETERMINISTIC CONTEXT ASSEMBLY.

Inspect:
- AGENTS.md;
- architecture maps;
- intelligence handoff surfaces;
- active packet/control artifacts;
- codebase map;
- current task packet format;
- agent worker prompt/context behavior.

Question:
Can the repository compile the smallest sufficient, freshness-aware context packet for ChatGPT/Claude so agents retrieve project understanding instead of reconstructing it?

This is now especially important because the context-integrity check in Trace 002B found canonical continuity surfaces at different freshness levels.


# KEYFLOWOS Surgical Package Standard

Version: 1  
Checkpoint: `PKGSTD-2026-09-17-01`

Every L2 surgical package MUST contain:

## 1. README.md
Human-readable mission:
- objective;
- business/product outcome;
- dependencies;
- explicit non-goals;
- hard stop conditions;
- implementation ordering.

## 2. SCOPE.yaml
Machine-readable contract:
- package id/version;
- owning journey/kernel;
- prerequisite packages;
- semantic write owners;
- read-only dependencies;
- expected source families;
- forbidden source families;
- schema/migration expectation;
- external/provider effects;
- rollout class;
- status.

## 3. TRACEABILITY.md
Bidirectional matrix:

```text
Product capability
↔ Journey law
↔ Kernel invariant
↔ Source seam
↔ Planned change
↔ Test/proof case
↔ Debug signal
↔ rollback consequence
```

No implementation change is valid if it cannot be traced through this table.

## 4. CHANGE-PLAN.md
Ordered, reversible implementation sequence:
- characterize;
- additive types/storage;
- adapters/readers;
- writer migration;
- shadow comparison;
- cutover;
- old writer disable;
- compatibility retirement later.

Every step must state:
- files/source family;
- data effect;
- external effect;
- rollback;
- proof required before next step.

## 5. DEBUG-CONTRACT.md
Required observability/debug vocabulary:
- correlation IDs;
- occurrence/effect IDs;
- decision/control IDs;
- provider IDs;
- structured log fields;
- diagnostic states;
- error categories;
- redaction rules;
- metrics/counters;
- tracing/span boundaries.

The package should be debuggable from one business occurrence without grepping arbitrary logs.

## 6. FAILURE-MATRIX.md
For each failure point:
- where it can fail;
- whether external effect may already exist;
- local state certainty;
- user-visible state;
- retry allowed?;
- repair action;
- reconciliation action;
- alert/severity;
- diagnostic evidence.

## 7. PROOF-MATRIX.md
For every locked invariant:
- proof case ID;
- test layer;
- fixture/resource requirement;
- negative control;
- expected evidence;
- admission class;
- implementation-independent evaluator if required.

## 8. ROLLBACK.md
Defines:
- reversible code/config changes;
- non-reversible external effects;
- migration rollback vs forward-repair;
- preserved evidence/history;
- disable path;
- stale worker/process handling.

## 9. IMPLEMENTER-HANDOFF.md
Claude Code instructions:
- files to inspect first;
- no-edit characterization return;
- allowed changes;
- forbidden shortcuts;
- stop conditions;
- exact return envelope.

## 10. REVIEWER-HANDOFF.md
Kimi Code adversarial review:
- bypass-writer scan;
- concurrency attacks;
- wrong-tenant/current-authority tests;
- migration ambiguity;
- proof-vacuity review;
- rollback challenge;
- observability gaps.

## 11. ACCEPTANCE-CHECKLIST.md
Binary checklist used by ChatGPT before promoting:
- L2 → L3;
- L3 → L4;
- L4 → L5;
- L5 → release consideration.

## Package design rules

1. One package owns one bounded semantic migration.
2. A package may touch multiple files but must not own multiple unrelated truths.
3. Shared primitives are dependency packages, not duplicated locally.
4. Every mutation path must have a debug correlation identity.
5. Every external effect must distinguish REQUESTED / ACCEPTED / OBSERVED / APPLIED / UNKNOWN.
6. Every retryable operation must expose semantic occurrence/effect identity.
7. Every package with money/authority/provider effects has explicit current-policy evidence.
8. Debug logging must not leak secrets/PII.
9. A package can be disabled without pretending already-completed real-world effects disappeared.
10. Package completion means proof at declared scope, never "code compiled."

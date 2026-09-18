# KF-EXEC-K12-001 — Proof Admission & Isolation Substrate

Status: DRAFT / EXECUTION-READY SHAPE / NO IMPLEMENTATION AUTHORIZATION
Whole-OS owner: K12 Engineering Control Plane
Evidence baseline: main@8f173bfe79f1418159cf4099ea18b0d60d203ec2

## 1. Objective

Make test/proof claims trustworthy without replacing Vitest/Turbo/CI.

A declared required proof scope must be admitted only when:
- exact expected case identities are present;
- no required cases are skipped/todo/missing/duplicated;
- setup/collection/unhandled errors are explicit;
- source/build/run identity is known;
- freshness vs cache reuse is known;
- nonproduction resources are admitted before unsafe collection/setup;
- cleanup/child termination is known;
- an evaluator independent of the candidate produces the verdict.

## 2. Current-state evidence

Use:
- J24-PROOF-ADMISSION-AND-RUN-ISOLATION-MAP.md
- J24-PROOF-ADMISSION-CONTRACT.yaml
- J24-SAFE-CHANGE-CONVERGENCE-REVIEW.md
- KF-KERNEL-012-ENGINEERING-CONTROL-PLANE.md
- whole-OS proof architecture.

Known positive seams:
- Vitest;
- Turbo;
- CI PostgreSQL/Redis/migration/server build;
- gate-vacuity source checks;
- native JSON/JUnit reporter capability direction;
- GrowthBook exposure seam;
- explicit package test families.

Known debts:
- no independent required-case report consumer at inspected default test:ci boundary;
- cache/freshness ambiguity for Turbo unit task;
- integration passWithNoTests=true;
- root-env/fixed-prefix integration fixture;
- boot evidence not equal HTTP readiness;
- no run-owned external resource allocator;
- no executed proof-admission bindings.

## 3. Accepted invariants

1. candidate cannot select/remove the policy that certifies itself;
2. missing/skipped/wrong-scope evidence rejects proof;
3. cached evidence is never described as a fresh run;
4. worktree isolation is not resource isolation;
5. nonproduction identity/capability is verified before unsafe module collection/setup;
6. run-owned resource identity is explicit;
7. cleanup uncertainty blocks unsafe resource reuse;
8. proof acceptance is separate from merge/release authorization;
9. safety invariants are not feature-flagged away;
10. requirement evolution is reviewed supersession, not gate weakening.

## 4. Journey / kernel impact

K12 primary.
Also J13, J18, J23, J2, J15 and every later implementation packet.

## 5. Target contract

AcceptedPolicyManifest
+ source/build identity
+ external run resource admission
+ native runner report
+ exact expected case set
+ cleanup receipt
→ independent ProofVerdict:
  REJECTED | INCOMPLETE | SATISFIED_AT_DECLARED_SCOPE

SATISFIED never means production authorization.

## 6. Existing seams to strengthen

- existing Vitest reporter output;
- existing CI services;
- existing test scripts/configs;
- existing gate-vacuity checks;
- existing GitHub/repository review boundaries;
- J13 designed isolated-test modes.

Do not add another test framework.

## 7. Prohibited shortcuts

- no passWithNoTests as proof of required integration scope;
- no test-count-only reconciliation;
- no candidate-owned expected-case list;
- no production DB/provider resources;
- no NODE_ENV-only safety assertion;
- no root env import before resource admission in new harness;
- no “boot succeeded” from absence of known error strings alone;
- no weakening existing assertions.

## 8. Likely affected files

Exact implementation must revalidate current main first.

Likely:
- root/package scripts and Turbo task config;
- apps/server Vitest configs;
- CI workflow test invocation;
- a new narrow proof-report consumer under an existing scripts/tools location;
- isolated test-resource provisioning/fixture entry points;
- no OS constitution edits unless separately authorized.

## 9. Migration concerns

This packet changes proof semantics, not production domain data.

Compatibility:
- current developer test commands should remain usable;
- required proof mode may be stricter than ad-hoc local mode;
- existing tests need explicit expected-case manifests only when enrolled as required proof;
- historical green logs remain historical evidence, not retroactively reclassified.

## 10. Characterization

Before edits:
- capture current runner version/config/report schema;
- characterize pass/fail/skip/todo/setup error/unhandled error output;
- characterize Turbo cache/replay markers;
- characterize boot child exit/readiness behavior;
- characterize test-resource acquisition order.

## 11. Acceptance proof

At minimum:
- missing required case → REJECTED;
- duplicate replacing missing identity → REJECTED;
- skipped/todo required case → REJECTED;
- setup/collection error → REJECTED;
- cancelled/missing shard → INCOMPLETE;
- cached run represented as fresh → REJECTED;
- wrong/shared/prod-like resource → reject before write-capable collection/setup;
- two concurrent runs receive disjoint resources;
- cleanup failure blocks reuse;
- negative control deliberately fails and proves evaluator sensitivity;
- candidate modification of its own accepted manifest is not self-certifying.

## 12. Non-goals

- no product feature changes;
- no provider integration redesign;
- no replacement CI platform;
- no universal test database service;
- no production canary.

## 13. Rollback

Tooling can be disabled only to the last safe proof mode; do not revert to treating missing evidence as success.
Historical receipts remain immutable.


## 14. Surgical package authority

This execution packet is now hardened to L2 under:
`docs/intelligence/packages/KF-EXEC-K12-001/`.

The package folder is authoritative for traceability, debug vocabulary, failure/proof matrices, rollback and agent handoffs. The packet remains the semantic scope owner.

# Development-Speed Trace 004C — Cross-Domain ContextBundle Replication (TENANT)

Status: ACTIVE R&D / CROSS-DOMAIN REPLICATION
Authority: RESEARCH ONLY
Sample packet: KF-EXEC-TENANT-001 / membership-first tenant genesis

## Question

Does the ContextBundle method derived from Hermans, Pragmatic Programmer, Ousterhout, Weinberg and repository history generalize beyond the control-plane packet?

## 1. Historical TENANT packet profile

The tenant packet was not merely a CRUD change.

Semantic change classes:
- AUTHORITY_MIGRATION
- DATA_OWNERSHIP_CHANGE
- TENANT_ISOLATION_CHANGE
- DISCOVERY_PATH_CHANGE
- BACKFILL/MIGRATION LOGIC

Critical surfaces:
- Business creation
- founding OWNER Membership
- BusinessGuard vs ModuleScopeGuard
- listBusinesses discovery
- Membership completeness
- backfill/inventory classification
- API projections
- integration tests
- architecture scanners

## 2. Historical correction evidence

Repository history records several important correction classes after the initial implementation:

### PAGINATION / COMPLETENESS
An unbounded-looking Prisma findMany was actually capped by a default-take extension. This could hide a conflicting OWNER row and make an ambiguous business look deterministically repairable.

### DATA DISCLOSURE
Select-less Business reads crossed a router boundary while the model contained decrypted OAuth token columns.

### MOCK FIDELITY
The identity-discovery test double did not model the new nested Membership-first predicate and therefore returned the wrong data shape.

### ARCHITECTURE MAP FRESHNESS
Architecture scanners needed regeneration after introducing the new service/operator path.

These are different failure classes, but all are derivable from the semantic nature of the task.

## 3. Candidate TENANT ContextBundle

```yaml
context_bundle:
  task:
    packet: KF-EXEC-TENANT-001
    change_classes:
      - AUTHORITY_MIGRATION
      - TENANT_ISOLATION_CHANGE
      - DATA_OWNERSHIP_CHANGE
      - BACKFILL_MIGRATION

  invariants:
    - every Business creation path yields exactly one founding OWNER Membership
    - caller tenancy and record tenancy are distinct checks
    - membership-based authorization must not diverge from owner compatibility semantics
    - ambiguous legacy rows are reported, not guessed
    - reads crossing API boundaries use explicit safe projections
    - inventory/backfill reads must be complete, not silently capped

  execution_paths:
    - authenticated business creation -> Business + Membership atomic write
    - bootstrap -> serializable transaction -> winner adoption
    - discovery -> Membership-first query + compatibility owner arm
    - backfill -> classify -> deterministic repair only
    - API router -> Business projection -> client

  historical_failure_classes:
    - PAGINATION_COMPLETENESS
    - AUTHORITY_IDENTITY
    - DATA_DISCLOSURE
    - MOCK_FIDELITY
    - MIGRATION_BACKFILL
    - ARCHITECTURE_MAP_DRIFT

  microproof:
    - enumerate all Business constructors
    - prove every constructor writes founding Membership
    - prove discovery predicate for owner and non-owner member
    - inspect ORM extensions that alter findMany semantics
    - inspect all selected Business columns crossing router boundaries

  semantic_proof:
    - conflicting owner rows
    - >1000 row estate / forced low page size
    - non-owner member discovery
    - cross-tenant refusal
    - owner compatibility before/after backfill
    - no token/raw secret disclosure
    - backfill refuses ambiguous/unresolvable rows
    - concurrent bootstrap convergence

  final_admission:
    - real DB integration
    - default test config, not only split local configs
    - architecture scanner refresh
    - exact-head broad CI
```

## 4. Cross-domain result

The ContextBundle method generalizes.

The control-plane packet and TENANT packet have different semantics, but the same compiler structure remains useful:

SNAPSHOT
-> CHANGE CLASSIFICATION
-> SEMANTIC OWNERSHIP
-> LIVE PATH
-> HISTORICAL FAILURE PROFILE
-> TASK-SPECIFIC PROOF PROFILE
-> FINAL ADMISSION.

The contents differ by domain, which is desirable.

## 5. What the bundle could have shifted earlier

### High-confidence PRE-SURFACEABLE
- caller-vs-record tenant distinction;
- safe API projection requirement for sensitive Business rows;
- all creation-path enumeration;
- real DB proof for tenancy;
- architecture-map regeneration requirement.

### High-confidence EARLY-DERIVABLE
- ORM default-take/pagination semantics;
- completeness under a low artificial page size;
- test double fidelity for nested membership predicates;
- ambiguous backfill classification.

### EMERGENT
Specific implementation bugs not inferable from the initial contract remain review/implementation findings.

## 6. Generalization verdict

VERDICT: CROSS-DOMAIN PROMISING.

The same ContextBundle contract appears useful in both:
- control-plane state/authority work;
- application-domain tenant/identity work.

This reduces the risk that Context Compiler is overfit to PR #120.

## 7. New reusable proof-profile family

Candidate semantic profile:

```yaml
profile: TENANT_AUTHORITY_DATA_BOUNDARY
required_checks:
  - enumerate_all_writers
  - caller_vs_record_tenant
  - complete_pagination
  - explicit_sensitive_projection
  - ambiguity_fail_closed
  - real_db_negative_controls
  - concurrent_genesis
  - backfill_idempotency
```

This profile could be reused for identity, team membership, roles, contacts-with-sensitive-fields and other tenant-bound resources.

## 8. R&D compounding result

Book-derived context theory now has:
- one control-plane historical replication;
- one application-domain historical replication;
- a stable candidate compiler shape;
- two distinct proof-profile families.

The next justified step is no longer another conceptual summary.

It is to define a machine-readable ContextBundle schema and prototype a deterministic compiler over existing repository sources, initially offline/research-only.

## 9. Safety boundary

Do not wire the compiler into Claude worker execution yet.

First prove:
- deterministic output;
- provenance preservation;
- stale-source detection;
- no hidden conflict resolution;
- context reduction without missing critical invariants;
- cross-domain usefulness on at least one more packet or live dry run.

